import { describe, expect, it, vi } from "vitest";
import { getTestInstance } from "../test-utils/test-instance";

describe("credential password mutation", () => {
	it("creates through account hooks, rejects replacement and lets reset replace the password", async () => {
		const afterCreate = vi.fn();
		const { auth } = await getTestInstance(
			{ databaseHooks: { account: { create: { after: afterCreate } } } },
			{ disableTestUser: true, transaction: true },
		);
		const { internalAdapter } = await auth.$context;
		const user = await internalAdapter.createUser(
			{
				name: "Ada",
				email: "credential@example.com",
				emailVerified: true,
			},
			{ method: "magic-link" },
		);
		await internalAdapter.setCredentialPassword(user.id, "first-hash", {
			overwrite: false,
			requireTransaction: true,
		});
		expect(afterCreate).toHaveBeenCalledOnce();
		await expect(
			internalAdapter.setCredentialPassword(user.id, "other-hash", {
				overwrite: false,
			}),
		).rejects.toMatchObject({ body: { code: "PASSWORD_ALREADY_SET" } });
		expect(
			(await internalAdapter.findCredentialAccount(user.id))?.password,
		).toBe("first-hash");
		await internalAdapter.setCredentialPassword(user.id, "reset-hash", {
			overwrite: true,
		});
		expect(
			(await internalAdapter.findCredentialAccount(user.id))?.password,
		).toBe("reset-hash");
		expect(await internalAdapter.findAccounts(user.id)).toHaveLength(1);
	});

	it.each([
		"create",
		"update",
	] as const)("fails when an account %s hook vetoes the mutation", async (operation) => {
		let blocked = false;
		const { auth } = await getTestInstance(
			{
				databaseHooks: {
					account: {
						[operation]: { before: async () => (blocked ? false : undefined) },
					},
				},
			},
			{ disableTestUser: true, transaction: true },
		);
		const { internalAdapter } = await auth.$context;
		const user = await internalAdapter.createUser(
			{
				name: "Ada",
				email: "veto@example.com",
				emailVerified: true,
			},
			{ method: "magic-link" },
		);
		if (operation === "update")
			await internalAdapter.setCredentialPassword(user.id, "original-hash", {
				overwrite: false,
			});
		blocked = true;
		await expect(
			internalAdapter.setCredentialPassword(user.id, "rejected-hash", {
				overwrite: true,
			}),
		).rejects.toThrow("was not persisted");
		expect(
			(await internalAdapter.findCredentialAccount(user.id))?.password,
		).toBe(operation === "update" ? "original-hash" : undefined);
	});

	it("rejects a required transaction before touching an unsupported database", async () => {
		const { auth } = await getTestInstance(
			{},
			{ disableTestUser: true, transaction: false },
		);
		const { internalAdapter, adapter } = await auth.$context;
		adapter.options!.adapterConfig.transaction = false;
		await expect(
			internalAdapter.setCredentialPassword("absent", "hash", {
				overwrite: false,
				requireTransaction: true,
			}),
		).rejects.toMatchObject({
			body: { code: "PASSWORD_REQUIRES_TRANSACTION" },
		});
	});
});
