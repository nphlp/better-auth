import type { UserWithTwoFactor } from "./types";

export function serializeTrustedDeviceValue(user: UserWithTwoFactor): string {
	return JSON.stringify({
		userId: user.id,
		twoFactorVersion: user.twoFactorVersion,
	});
}

export function matchesTrustedDeviceValue(
	value: string,
	user: UserWithTwoFactor,
): boolean {
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null) return false;
		const record = parsed as Record<string, unknown>;
		return (
			record.userId === user.id &&
			record.twoFactorVersion === user.twoFactorVersion
		);
	} catch {
		return false;
	}
}
