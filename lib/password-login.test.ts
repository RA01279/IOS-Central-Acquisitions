import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizedAuthPassword, signInWithPassword } from "./password-login";

describe("password login compatibility", () => {
  it("preserves an existing case-sensitive login without retrying", async () => {
    const login = vi.fn().mockResolvedValue({ error: null });
    await signInWithPassword({ auth: { signInWithPassword: login } } as unknown as SupabaseClient, "USER@example.com", "MixedCase");
    expect(login.mock.calls).toEqual([[{ email: "user@example.com", password: "MixedCase" }]]);
  });

  it("uses the provisioned format after invalid credentials only", async () => {
    const login = vi.fn().mockResolvedValueOnce({ error: { code: "invalid_credentials" } }).mockResolvedValueOnce({ error: null });
    await signInWithPassword({ auth: { signInWithPassword: login } } as unknown as SupabaseClient, "USER@example.com", "MiXeD");
    expect(login.mock.calls[1][0]).toEqual({ email: "user@example.com", password: await normalizedAuthPassword("user@example.com", "mixed") });
  });

  it("does not retry rate limits", async () => {
    const login = vi.fn().mockResolvedValue({ error: { code: "over_request_rate_limit" } });
    await signInWithPassword({ auth: { signInWithPassword: login } } as unknown as SupabaseClient, "user@example.com", "mixed");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("normalizes case but keeps different passwords and accounts distinct", async () => {
    const value = await normalizedAuthPassword("USER@example.com", "MiXeD");
    expect(value).toBe(await normalizedAuthPassword("user@example.com", "MIXED"));
    expect(value).not.toBe(await normalizedAuthPassword("user@example.com", "wrong"));
    expect(value).not.toBe(await normalizedAuthPassword("other@example.com", "mixed"));
  });
});
