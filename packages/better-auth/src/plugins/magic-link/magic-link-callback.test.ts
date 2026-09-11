import { describe, expect, it } from "vitest";
import { getTestInstance } from "../../test-utils/test-instance";
import { magicLink } from ".";

const callbackKeys = [
	"callbackURL",
	"newUserCallbackURL",
	"errorCallbackURL",
] as const;

/** @see https://better-auth.com/docs/plugins/magic-link */
describe("magic-link HTTP callback encoding", () => {
	for (const callbackKey of callbackKeys) {
		it.each([
			"relative",
			"absolute",
		])(`preserves %s ${callbackKey} through the emailed URL`, async (kind) => {
			let emailedURL = "";
			const { auth, testUser } = await getTestInstance({
				advanced: { disableOriginCheck: false },
				plugins: [
					magicLink({
						async sendMagicLink({ url }) {
							emailedURL = url;
						},
					}),
				],
			});
			const path =
				"/account/contact?label=a%26b&reserved=%23%3F%3D%2B%25&nested=%2526#section%23one";
			const callback =
				kind === "absolute" ? `http://localhost:3000${path}` : path;
			await auth.api.signInMagicLink({
				headers: new Headers(),
				body: {
					email:
						callbackKey === "newUserCallbackURL"
							? "new-user@example.com"
							: testUser.email,
					[callbackKey]: callback,
				},
			});
			const verificationURL = new URL(emailedURL);
			expect(verificationURL.searchParams.get(callbackKey)).toBe(callback);
			if (callbackKey === "errorCallbackURL") {
				verificationURL.searchParams.set("token", "invalid-token");
			}
			const response = await auth.handler(new Request(verificationURL));
			expect(response.status).toBe(302);
			const expected = new URL(callback, "http://localhost:3000");
			if (callbackKey === "errorCallbackURL") {
				expected.searchParams.set("error", "INVALID_TOKEN");
			}
			expect(response.headers.get("location")).toBe(expected.toString());
		});

		it.each([
			"https://untrusted.example/target",
			"//untrusted.example/target",
		])(`rejects an untrusted ${callbackKey}: %s`, async (callback) => {
			const { auth } = await getTestInstance({
				advanced: { disableOriginCheck: false },
				plugins: [magicLink({ async sendMagicLink() {} })],
			});
			const verificationURL = new URL(
				"http://localhost:3000/api/auth/magic-link/verify",
			);
			verificationURL.searchParams.set("token", "invalid-token");
			verificationURL.searchParams.set(callbackKey, callback);
			const response = await auth.handler(new Request(verificationURL));
			expect(response.status).toBe(403);
			expect(response.headers.get("location")).toBeNull();
		});
	}
});
