import { describe, expect, it } from "vitest";
import { resolveScope } from "./leaderboards.js";

const userId = "11111111-1111-4111-8111-111111111111";

describe("social leaderboard scopes", () => {
  it("includes the current user and both sides of friendships", async () => {
    const result = await resolveScope(
      {
        prisma: {
          friendship: {
            findMany: async () => [
              { userAId: userId, userBId: "friend-b" },
              { userAId: "friend-a", userBId: userId }
            ]
          }
        }
      } as never,
      userId,
      "friends"
    );

    expect(result.userIds).toEqual([userId, "friend-b", "friend-a"]);
    expect(result.suppressed).toBe(false);
  });

  it("suppresses company rankings with fewer than three members", async () => {
    const result = await resolveScope(
      companyServer([
        { userId, anonymousAlias: "工位同学 01" },
        { userId: "friend-a", anonymousAlias: "工位同学 02" }
      ]),
      userId,
      "company"
    );

    expect(result).toMatchObject({
      userIds: [],
      suppressed: true,
      suppressionReason: "COMPANY_TOO_SMALL"
    });
  });

  it("returns only anonymous aliases for an eligible company scope", async () => {
    const result = await resolveScope(
      companyServer([
        { userId, anonymousAlias: "工位同学 01" },
        { userId: "friend-a", anonymousAlias: "工位同学 02" },
        { userId: "friend-b", anonymousAlias: "工位同学 03" }
      ]),
      userId,
      "company"
    );

    expect(result.suppressed).toBe(false);
    expect(result.aliases?.get("friend-b")).toBe("工位同学 03");
  });
});

function companyServer(members: Array<{ userId: string; anonymousAlias: string }>) {
  return {
    prisma: {
      companyMembership: {
        findUnique: async () => ({ userId, companyId: "company-1" }),
        findMany: async () => members
      }
    }
  } as never;
}
