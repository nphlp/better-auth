import { createOTP } from "@better-auth/utils/otp";
import { describe, expect, it } from "vitest";
import { symmetricDecrypt } from "../../crypto";
import { convertSetCookieToCookie } from "../../test-utils/headers";
import { getTestInstance } from "../../test-utils/test-instance";
import { lastLoginMethod } from "../last-login-method";
import { twoFactor } from "../two-factor";
import { magicLink } from ".";

describe("explicit passwordless onboarding", () => {
	it("rejects a remembered-method plugin placed before the two-factor gate", async () => {
		await expect(
			getTestInstance({
				plugins: [
					lastLoginMethod(),
					twoFactor(),
					magicLink({ sendMagicLink: () => {} }),
				],
			}),
		).rejects.toThrow("Place lastLoginMethod after twoFactor");
	});

	it("creates the verified profile only when the link is consumed, without credentials", async () => {
		let url = "";
		const { auth, db } = await getTestInstance(
			{
				user: {
					additionalFields: { lastname: { type: "string", required: true } },
				},
				plugins: [
					magicLink({
						requireExplicitSignUp: true,
						sendMagicLink: (data) => {
							url = data.url;
						},
					}),
				],
			},
			{ disableTestUser: true },
		);
		const context = await auth.$context;
		const email = "new-profile@example.com";
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: {
				email,
				signUp: {
					name: "Ada",
					additionalFields: {
						lastname: "Lovelace",
						role: "ADMIN",
						emailVerified: false,
					},
				},
				callbackURL: "/account",
			},
		});
		expect(await context.internalAdapter.findUserByEmail(email)).toBeNull();
		const verified = await auth.handler(new Request(url));
		expect(verified.status).toBe(302);
		const found = await context.internalAdapter.findUserByEmail(email);
		expect(found?.user).toMatchObject({
			name: "Ada",
			lastname: "Lovelace",
			emailVerified: true,
		});
		expect(found?.user).not.toHaveProperty("role", "ADMIN");
		expect(await db.findMany({ model: "account" })).toHaveLength(0);
		const replay = await auth.handler(new Request(url));
		expect(replay.headers.get("location")).toContain("INVALID_TOKEN");
	});

	it("requires explicit profile data for signup while allowing ordinary existing-user login", async () => {
		let url = "";
		const { auth } = await getTestInstance({
			plugins: [
				magicLink({
					requireExplicitSignUp: true,
					sendMagicLink: (data) => {
						url = data.url;
					},
				}),
			],
		});
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: { email: "unknown@example.com", callbackURL: "/" },
		});
		const response = await auth.handler(new Request(url));
		expect(response.headers.get("location")).toContain(
			"new_user_signup_disabled",
		);
		expect(
			await (await auth.$context).internalAdapter.findUserByEmail(
				"unknown@example.com",
			),
		).toBeNull();
	});

	it("keeps email-link login pending until TOTP and then remembers the primary method", async () => {
		let url = "";
		const { auth, testUser, db } = await getTestInstance({
			plugins: [
				twoFactor({
					magicLinkTwoFactorRedirect: () => "http://localhost:3000/verify-2fa",
				}),
				magicLink({
					sendMagicLink: (data) => {
						url = data.url;
					},
				}),
				lastLoginMethod(),
			],
		});
		const login = await auth.api.signInEmail({
			body: testUser,
			asResponse: true,
		});
		const headers = convertSetCookieToCookie(new Headers(login.headers));
		const setup = await auth.api.enableTwoFactor({
			headers,
			body: { password: testUser.password, method: "totp" },
		});
		if (setup.method !== "totp") throw new Error("Expected TOTP enrollment");
		const row = await db.findOne<{ secret: string }>({
			model: "twoFactor",
			where: [
				{
					field: "userId",
					value: (await auth.api.getSession({ headers }))!.user.id,
				},
			],
		});
		const secret = await symmetricDecrypt({
			key: (await auth.$context).secretConfig,
			data: row!.secret,
		});
		await auth.api.verifyTOTP({
			headers,
			body: { code: await createOTP(secret).totp() },
		});
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: { email: testUser.email, callbackURL: "/account" },
		});
		const pending = await auth.handler(new Request(url));
		expect(pending.headers.get("location")).toBe(
			"http://localhost:3000/verify-2fa",
		);
		const pendingHeaders = convertSetCookieToCookie(
			new Headers(pending.headers),
		);
		expect(await auth.api.getSession({ headers: pendingHeaders })).toBeNull();
		expect(
			pending.headers
				.getSetCookie()
				.some((cookie) =>
					cookie.startsWith("better-auth.last_used_login_method="),
				),
		).toBe(false);
		const completed = await auth.api.verifyTOTP({
			headers: pendingHeaders,
			body: { code: await createOTP(secret).totp() },
			asResponse: true,
		});
		expect(completed.status).toBe(200);
		expect(completed.headers.getSetCookie()).toContainEqual(
			expect.stringContaining("better-auth.last_used_login_method=magic-link"),
		);
		expect(
			await auth.api.getSession({
				headers: convertSetCookieToCookie(new Headers(completed.headers)),
			}),
		).not.toBeNull();
	});
	it("validates declared profile fields before sending a link and ignores protected fields", async () => {
		let delivered = 0;
		let url = "";
		const { auth } = await getTestInstance(
			{
				user: {
					additionalFields: {
						lastname: { type: "string", required: true },
						role: { type: "string", input: false, defaultValue: "member" },
					},
				},
				plugins: [
					magicLink({
						requireExplicitSignUp: true,
						sendMagicLink: (data) => {
							delivered++;
							url = data.url;
						},
					}),
				],
			},
			{ disableTestUser: true },
		);
		await expect(
			auth.api.signInMagicLink({
				headers: new Headers(),
				body: {
					email: "profile@example.com",
					signUp: { name: "Ada", additionalFields: {} },
				},
			}),
		).rejects.toMatchObject({ status: "BAD_REQUEST" });
		expect(delivered).toBe(0);
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: {
				email: "profile@example.com",
				signUp: {
					name: "Ada",
					additionalFields: { lastname: "Lovelace", role: "admin" },
				},
			},
		});
		await auth.handler(new Request(url));
		const found = await (await auth.$context).internalAdapter.findUserByEmail(
			"profile@example.com",
		);
		expect(found?.user).toMatchObject({
			name: "Ada",
			lastname: "Lovelace",
			role: "member",
		});
	});

	it("does not overwrite an existing profile when a signup link is submitted", async () => {
		let url = "";
		const { auth, testUser } = await getTestInstance({
			plugins: [
				magicLink({
					requireExplicitSignUp: true,
					sendMagicLink: (data) => {
						url = data.url;
					},
				}),
			],
		});
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: {
				email: testUser.email,
				signUp: { name: "Replacement" },
			},
		});
		const result = await auth.handler(new Request(url));
		expect(result.status).toBe(302);
		const found = await (await auth.$context).internalAdapter.findUserByEmail(
			testUser.email,
		);
		expect(found?.user.name).toBe(testUser.name);
	});

	it("never creates a profile from an expired signup link", async () => {
		let url = "";
		const { auth, db } = await getTestInstance(
			{
				plugins: [
					magicLink({
						requireExplicitSignUp: true,
						sendMagicLink: (data) => {
							url = data.url;
						},
					}),
				],
			},
			{ disableTestUser: true },
		);
		const email = "expired-profile@example.com";
		await auth.api.signInMagicLink({
			headers: new Headers(),
			body: { email, signUp: { name: "Ada" } },
		});
		const rows = await db.findMany<{ id: string }>({ model: "verification" });
		expect(rows).toHaveLength(1);
		await db.update({
			model: "verification",
			where: [{ field: "id", value: rows[0]!.id }],
			update: { expiresAt: new Date(Date.now() - 1000) },
		});
		const response = await auth.handler(new Request(url));
		expect(response.headers.get("location")).toContain("error=");
		expect(
			await (await auth.$context).internalAdapter.findUserByEmail(email),
		).toBeNull();
		expect(
			await auth.api.getSession({
				headers: convertSetCookieToCookie(new Headers(response.headers)),
			}),
		).toBeNull();
	});
});
