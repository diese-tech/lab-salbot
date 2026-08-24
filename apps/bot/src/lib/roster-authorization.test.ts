import { describe, expect, it } from "vitest";
import { authorizedForRosterOrganization } from "./roster-authorization";

const env = {
  SAL_OPERATOR_ROLE_IDS: "10000000000000001",
  SAL_ADMIN_ROLE_IDS: "10000000000000002",
};

describe("roster transaction authorization", () => {
  it("allows administrators to represent any organization", () => {
    withEnv(() =>
      expect(
        authorizedForRosterOrganization(
          member(["10000000000000002"]),
          "admin",
          "20000000000000001",
          { captainDiscordIds: [], organizationRoleId: null },
        ),
      ).toBe(true),
    );
  });

  it("allows an organization owner or advisor without a division Captain role", () => {
    withEnv(() =>
      expect(
        authorizedForRosterOrganization(
          member(["30000000000000001"]),
          "owner",
          "20000000000000001",
          { captainDiscordIds: [], organizationRoleId: "30000000000000001" },
        ),
      ).toBe(true),
    );
  });

  it("requires both canonical captain identity and the division Captain role", () => {
    withEnv(() => {
      expect(
        authorizedForRosterOrganization(
          member(["20000000000000001"]),
          "captain",
          "20000000000000001",
          { captainDiscordIds: ["captain"], organizationRoleId: null },
        ),
      ).toBe(true);
      expect(
        authorizedForRosterOrganization(
          member([]),
          "captain",
          "20000000000000001",
          { captainDiscordIds: ["captain"], organizationRoleId: null },
        ),
      ).toBe(false);
      expect(
        authorizedForRosterOrganization(
          member(["20000000000000001"]),
          "former-captain",
          "20000000000000001",
          { captainDiscordIds: ["captain"], organizationRoleId: null },
        ),
      ).toBe(false);
    });
  });

  it("does not grant authority from an ordinary player team role", () => {
    withEnv(() =>
      expect(
        authorizedForRosterOrganization(
          member(["40000000000000001"]),
          "player",
          "20000000000000001",
          { captainDiscordIds: [], organizationRoleId: "30000000000000001" },
        ),
      ).toBe(false),
    );
  });
});

function member(roleIds: string[]) {
  return { roles: roleIds } as never;
}

function withEnv(run: () => void): void {
  const previousOperator = process.env.SAL_OPERATOR_ROLE_IDS;
  const previousAdmin = process.env.SAL_ADMIN_ROLE_IDS;
  process.env.SAL_OPERATOR_ROLE_IDS = env.SAL_OPERATOR_ROLE_IDS;
  process.env.SAL_ADMIN_ROLE_IDS = env.SAL_ADMIN_ROLE_IDS;
  try {
    run();
  } finally {
    if (previousOperator === undefined)
      delete process.env.SAL_OPERATOR_ROLE_IDS;
    else process.env.SAL_OPERATOR_ROLE_IDS = previousOperator;
    if (previousAdmin === undefined) delete process.env.SAL_ADMIN_ROLE_IDS;
    else process.env.SAL_ADMIN_ROLE_IDS = previousAdmin;
  }
}
