/**
 * Splitwise REST API client.
 *
 * Each instance is bound to a single user's Splitwise access token. Tool
 * handlers create one per invocation via `SplitwiseClient.fromRequestInfo`.
 *
 * The public convenience methods (`getFriends`, `getGroups`, ...) return
 * normalized payloads: the noisy fields from the raw API (picture objects,
 * avatars, cover photos, whiteboard metadata, etc.) are stripped so
 * consumers — especially MCP tool handlers dumping JSON back to a model —
 * get a compact, meaningful shape. The escape-hatch `get`/`post` methods
 * remain available when you need the raw response.
 *
 * API docs: https://dev.splitwise.com/
 */

import { cacheDel, cacheGet, cacheKeys, cacheSet, tokenHash } from "../cache";
import {
  CACHE_TTL_FRIENDS_SEC,
  CACHE_TTL_GROUPS_SEC,
  CACHE_TTL_METADATA_SEC,
  CACHE_TTL_USER_SEC,
  SPLITWISE_API_BASE,
} from "../config";
import { log } from "../logger";

/**
 * Every cacheable read accepts this option bag. `forceRefresh: true` skips
 * the cache read (but still repopulates on success).
 */
export type ReadOptions = { forceRefresh?: boolean };

type Headers = Record<string, string | string[] | undefined>;

export type SplitwiseResponse<T = unknown> = {
  status: number;
  data: T;
};

// --- Normalized shapes returned by the high-level methods. ---

export type Balance = {
  currency_code: string;
  amount: string;
};

export type UserSummary = {
  id: number;
  first_name: string;
  last_name: string | null;
  full_name: string;
  email: string | null;
  registration_status?: "confirmed" | "invited" | "dummy";
};

export type MemberSummary = UserSummary & {
  balance: Balance[];
};

export type FriendSummary = UserSummary & {
  balance: Balance[];
  /** Per-group balances between the current user and this friend. */
  groups: { group_id: number; balance: Balance[] }[];
  updated_at: string | null;
};

export type Debt = {
  from: number;
  to: number;
  amount: string;
  currency_code: string;
};

export type SplitwiseGroupType =
  | "home"
  | "trip"
  | "couple"
  | "other"
  | "apartment"
  | "house";

export type GroupSummary = {
  id: number;
  name: string;
  group_type: SplitwiseGroupType | null;
  simplify_by_default: boolean;
  updated_at: string | null;
  invite_link: string | null;
  members: MemberSummary[];
  original_debts: Debt[];
  simplified_debts: Debt[];
};

// --- Request payload shapes for mutations. ---

export type UpdateUserPayload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  locale?: string;
  default_currency?: string;
};

/**
 * Splitwise's `/create_group` endpoint expects user fields flattened into
 * keys of the form `users__{index}__{property}` (e.g. `users__0__email`).
 * Either `user_id` or `email` must be supplied per user.
 */
export type CreateGroupPayload = {
  name: string;
  group_type?: SplitwiseGroupType;
  simplify_by_default?: boolean;
} & {
  [K in `users__${number}__${
    | "user_id"
    | "first_name"
    | "last_name"
    | "email"}`]?: string | number;
};

export type AddUserToGroupPayload =
  | { group_id: number; user_id: number }
  | {
      group_id: number;
      first_name: string;
      last_name?: string;
      email: string;
    };

export type RemoveUserFromGroupPayload = {
  group_id: number;
  user_id: number;
};

// --- Expenses ---

export type RepeatInterval =
  | "never"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "yearly";

export type ExpenseShare = {
  user_id: number;
  paid_share: string;
  owed_share: string;
  net_balance: string | null;
  user: UserSummary | null;
};

export type ExpenseRepayment = {
  from: number;
  to: number;
  amount: string;
};

export type ExpenseCategory = {
  id: number;
  name: string;
};

export type ExpenseSummary = {
  id: number;
  group_id: number | null;
  friendship_id: number | null;
  description: string;
  details: string | null;
  cost: string;
  currency_code: string;
  date: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  payment: boolean;
  repeats: boolean;
  repeat_interval: RepeatInterval | null;
  category: ExpenseCategory | null;
  users: ExpenseShare[];
  repayments: ExpenseRepayment[];
  comments_count: number;
};

/**
 * Splitwise's `/create_expense` and `/update_expense` endpoints expect per-user
 * share fields flattened into `users__{index}__{property}`. We only support
 * identifying users by `user_id` (email/first_name/last_name are omitted on
 * purpose to keep the tool surface small).
 */
export type CreateExpensePayload = {
  cost: string;
  description: string;
  details?: string;
  date?: string;
  repeat_interval?: RepeatInterval;
  currency_code?: string;
  category_id?: number;
  /** `0` (or omitted) means "not a group expense". */
  group_id: number;
  /** Only valid when a non-zero `group_id` is supplied. */
  split_equally?: boolean;
  /** `true` marks this row as a payment between users, not an expense. */
  payment?: boolean;
} & {
  [K in `users__${number}__${
    | "user_id"
    | "paid_share"
    | "owed_share"}`]?: string | number;
};

export type GetExpensesQuery = {
  group_id?: number;
  friend_id?: number;
  dated_after?: string;
  dated_before?: string;
  updated_after?: string;
  updated_before?: string;
  limit?: number;
  offset?: number;
};

// --- Friends ---

export type CreateFriendPayload = {
  user_email: string;
  user_first_name?: string;
  user_last_name?: string;
};

export type CreateFriendsUser = {
  email: string;
  first_name?: string;
  last_name?: string;
};

// --- Comments ---

export type CommentType = "System" | "User";

export type CommentSummary = {
  id: number;
  content: string;
  comment_type: CommentType | null;
  relation_type: string | null;
  relation_id: number | null;
  created_at: string | null;
  deleted_at: string | null;
  user: UserSummary | null;
};

// --- Notifications ---

export type NotificationSummary = {
  id: number;
  type: number;
  created_at: string | null;
  created_by: number | null;
  source: { type: string; id: number; url: string | null } | null;
  content: string;
};

// --- Currencies & categories ---

export type Currency = { currency_code: string; unit: string };

export type CategorySummary = {
  id: number;
  name: string;
  subcategories: { id: number; name: string }[];
};

export class SplitwiseClient {
  /**
   * Short, stable hash of `token`. Used to scope Redis cache keys so two
   * users of this MCP server never see each other's cached data.
   */
  private readonly hash: string;

  constructor(private readonly token: string) {
    this.hash = tokenHash(token);
  }

  /**
   * Build a client from the request headers injected by the MCP `/mcp`
   * router. Returns `null` when no token is present (caller should treat this
   * as "not authenticated").
   */
  static fromRequestInfo(
    requestInfo: { headers?: Headers } | undefined
  ): SplitwiseClient | null {
    const raw = requestInfo?.headers?.["x-splitwise-token"];
    const token = typeof raw === "string" ? raw : null;
    return token ? new SplitwiseClient(token) : null;
  }

  /** Raw GET. Returns `{ status, data }` where data is parsed JSON if possible. */
  get<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<SplitwiseResponse<T>> {
    return this.request<T>("GET", appendQuery(path, query));
  }

  /** Raw POST with an optional JSON body. */
  post<T = unknown>(path: string, body?: unknown): Promise<SplitwiseResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<SplitwiseResponse<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await fetch(`${SPLITWISE_API_BASE}${path}`, init);
    const bodyText = await res.text();
    log(`SPLITWISE ${method} ${path}`, { status: res.status });

    let data: unknown;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }
    return { status: res.status, data: data as T };
  }

  // --- High-level, normalized wrappers for the endpoints we care about. ---

  async getCurrentUser(
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ user: UserSummary | null }>> {
    const key = cacheKeys.userMe(this.hash);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ user: UserSummary | null }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ user?: RawUser }>("/get_current_user");
    const data = {
      user: res.data?.user ? toUserSummary(res.data.user) : null,
    };
    if (res.status === 200 && data.user) {
      await cacheSet(key, CACHE_TTL_USER_SEC, data);
    }
    return { status: res.status, data };
  }

  async getUser(
    id: number,
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ user: UserSummary | null }>> {
    const key = cacheKeys.userById(this.hash, id);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ user: UserSummary | null }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ user?: RawUser }>(`/get_user/${id}`);
    const data = {
      user: res.data?.user ? toUserSummary(res.data.user) : null,
    };
    if (res.status === 200 && data.user) {
      await cacheSet(key, CACHE_TTL_USER_SEC, data);
    }
    return { status: res.status, data };
  }

  async updateUser(
    id: number,
    payload: UpdateUserPayload
  ): Promise<SplitwiseResponse<{ user: UserSummary | null }>> {
    const res = await this.post<{ user?: RawUser } | RawUser>(
      `/update_user/${id}`,
      payload
    );
    const raw = unwrapUser(res.data);
    if (res.status === 200) {
      await cacheDel(
        cacheKeys.userMe(this.hash),
        cacheKeys.userById(this.hash, id)
      );
    }
    return {
      status: res.status,
      data: { user: raw ? toUserSummary(raw) : null },
    };
  }

  async getFriends(
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ friends: FriendSummary[] }>> {
    const key = cacheKeys.friendsList(this.hash);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ friends: FriendSummary[] }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ friends?: RawFriend[] }>("/get_friends");
    const data = {
      friends: (res.data?.friends ?? []).map(toFriendSummary),
    };
    if (res.status === 200) {
      await cacheSet(key, CACHE_TTL_FRIENDS_SEC, data);
    }
    return { status: res.status, data };
  }

  async getGroups(
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ groups: GroupSummary[] }>> {
    const key = cacheKeys.groupsList(this.hash);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ groups: GroupSummary[] }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ groups?: RawGroup[] }>("/get_groups");
    const data = {
      groups: (res.data?.groups ?? []).map(toGroupSummary),
    };
    if (res.status === 200) {
      await cacheSet(key, CACHE_TTL_GROUPS_SEC, data);
    }
    return { status: res.status, data };
  }

  async getGroup(
    id: number,
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ group: GroupSummary | null }>> {
    const key = cacheKeys.groupById(this.hash, id);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ group: GroupSummary | null }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ group?: RawGroup }>(`/get_group/${id}`);
    const data = {
      group: res.data?.group ? toGroupSummary(res.data.group) : null,
    };
    if (res.status === 200 && data.group) {
      await cacheSet(key, CACHE_TTL_GROUPS_SEC, data);
    }
    return { status: res.status, data };
  }

  async createGroup(
    payload: CreateGroupPayload
  ): Promise<SplitwiseResponse<{ group: GroupSummary | null; errors?: unknown }>> {
    const res = await this.post<{ group?: RawGroup; errors?: unknown }>(
      "/create_group",
      payload
    );
    if (res.status === 200 && res.data?.group) {
      await this.invalidateGroupsAndFriends();
    }
    return {
      status: res.status,
      data: {
        group: res.data?.group ? toGroupSummary(res.data.group) : null,
        errors: res.data?.errors,
      },
    };
  }

  async deleteGroup(id: number) {
    const res = await this.post<{ success: boolean; errors?: unknown }>(
      `/delete_group/${id}`
    );
    if (res.data?.success) {
      await cacheDel(cacheKeys.groupById(this.hash, id));
      await this.invalidateGroupsAndFriends();
    }
    return res;
  }

  async undeleteGroup(id: number) {
    const res = await this.post<{ success: boolean; errors?: unknown }>(
      `/undelete_group/${id}`
    );
    if (res.data?.success) {
      await cacheDel(cacheKeys.groupById(this.hash, id));
      await this.invalidateGroupsAndFriends();
    }
    return res;
  }

  async removeUserFromGroup(
    payload: RemoveUserFromGroupPayload
  ): Promise<SplitwiseResponse<{ success: boolean; errors?: unknown }>> {
    const res = await this.post<{ success: boolean; errors?: unknown }>(
      "/remove_user_from_group",
      payload
    );
    if (res.data?.success) {
      await cacheDel(cacheKeys.groupById(this.hash, payload.group_id));
      await this.invalidateGroupsAndFriends();
    }
    return res;
  }

  /**
   * Nuke both the groups list and the friends list caches — any group-level
   * mutation can ripple into `/get_friends` (per-group balances) so we wipe
   * both. Per-id entries still live on their short TTL.
   */
  private async invalidateGroupsAndFriends(): Promise<void> {
    await cacheDel(
      cacheKeys.groupsList(this.hash),
      cacheKeys.friendsList(this.hash)
    );
  }

  // --- Expenses ---

  async getExpense(
    id: number
  ): Promise<SplitwiseResponse<{ expense: ExpenseSummary | null }>> {
    const res = await this.get<{ expense?: RawExpense }>(`/get_expense/${id}`);
    return {
      status: res.status,
      data: {
        expense: res.data?.expense ? toExpenseSummary(res.data.expense) : null,
      },
    };
  }

  async getExpenses(
    query: GetExpensesQuery = {}
  ): Promise<SplitwiseResponse<{ expenses: ExpenseSummary[] }>> {
    const res = await this.get<{ expenses?: RawExpense[] }>(
      "/get_expenses",
      query
    );
    return {
      status: res.status,
      data: {
        expenses: (res.data?.expenses ?? []).map(toExpenseSummary),
      },
    };
  }

  async createExpense(
    payload: CreateExpensePayload
  ): Promise<
    SplitwiseResponse<{ expenses: ExpenseSummary[]; errors?: unknown }>
  > {
    const res = await this.post<{
      expenses?: RawExpense[];
      errors?: unknown;
    }>("/create_expense", payload);
    return {
      status: res.status,
      data: {
        expenses: (res.data?.expenses ?? []).map(toExpenseSummary),
        errors: res.data?.errors,
      },
    };
  }

  async updateExpense(
    id: number,
    payload: Partial<CreateExpensePayload>
  ): Promise<
    SplitwiseResponse<{ expenses: ExpenseSummary[]; errors?: unknown }>
  > {
    const res = await this.post<{
      expenses?: RawExpense[];
      errors?: unknown;
    }>(`/update_expense/${id}`, payload);
    return {
      status: res.status,
      data: {
        expenses: (res.data?.expenses ?? []).map(toExpenseSummary),
        errors: res.data?.errors,
      },
    };
  }

  deleteExpense(id: number) {
    return this.post<{ success: boolean; errors?: unknown }>(
      `/delete_expense/${id}`
    );
  }

  undeleteExpense(id: number) {
    return this.post<{ success: boolean; errors?: unknown }>(
      `/undelete_expense/${id}`
    );
  }

  // --- Friends ---

  async getFriend(
    id: number,
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ friend: FriendSummary | null }>> {
    const key = cacheKeys.friendById(this.hash, id);
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ friend: FriendSummary | null }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ friend?: RawFriend }>(`/get_friend/${id}`);
    const data = {
      friend: res.data?.friend ? toFriendSummary(res.data.friend) : null,
    };
    if (res.status === 200 && data.friend) {
      await cacheSet(key, CACHE_TTL_FRIENDS_SEC, data);
    }
    return { status: res.status, data };
  }

  async createFriend(
    payload: CreateFriendPayload
  ): Promise<SplitwiseResponse<{ friend: FriendSummary | null }>> {
    const res = await this.post<{ friend?: RawFriend }>(
      "/create_friend",
      payload
    );
    if (res.status === 200 && res.data?.friend) {
      await cacheDel(cacheKeys.friendsList(this.hash));
    }
    return {
      status: res.status,
      data: {
        friend: res.data?.friend ? toFriendSummary(res.data.friend) : null,
      },
    };
  }

  async createFriends(
    users: CreateFriendsUser[]
  ): Promise<
    SplitwiseResponse<{ users: FriendSummary[]; errors?: unknown }>
  > {
    const body: Record<string, string> = {};
    users.forEach((u, i) => {
      body[`users__${i}__email`] = u.email;
      if (u.first_name !== undefined)
        body[`users__${i}__first_name`] = u.first_name;
      if (u.last_name !== undefined)
        body[`users__${i}__last_name`] = u.last_name;
    });
    const res = await this.post<{
      users?: RawFriend[];
      errors?: unknown;
    }>("/create_friends", body);
    if (res.status === 200 && (res.data?.users?.length ?? 0) > 0) {
      await cacheDel(cacheKeys.friendsList(this.hash));
    }
    return {
      status: res.status,
      data: {
        users: (res.data?.users ?? []).map(toFriendSummary),
        errors: res.data?.errors,
      },
    };
  }

  async deleteFriend(id: number) {
    const res = await this.post<{ success: boolean; errors?: unknown }>(
      `/delete_friend/${id}`
    );
    if (res.data?.success) {
      await cacheDel(
        cacheKeys.friendsList(this.hash),
        cacheKeys.friendById(this.hash, id)
      );
    }
    return res;
  }

  // --- Comments ---

  async getComments(
    expenseId: number
  ): Promise<SplitwiseResponse<{ comments: CommentSummary[] }>> {
    const res = await this.get<{ comments?: RawComment[] }>("/get_comments", {
      expense_id: expenseId,
    });
    return {
      status: res.status,
      data: {
        comments: (res.data?.comments ?? []).map(toCommentSummary),
      },
    };
  }

  async createComment(
    expenseId: number,
    content: string
  ): Promise<SplitwiseResponse<{ comment: CommentSummary | null }>> {
    const res = await this.post<{ comment?: RawComment }>("/create_comment", {
      expense_id: expenseId,
      content,
    });
    return {
      status: res.status,
      data: {
        comment: res.data?.comment ? toCommentSummary(res.data.comment) : null,
      },
    };
  }

  async deleteComment(
    id: number
  ): Promise<SplitwiseResponse<{ comment: CommentSummary | null }>> {
    const res = await this.post<{ comment?: RawComment }>(
      `/delete_comment/${id}`
    );
    return {
      status: res.status,
      data: {
        comment: res.data?.comment ? toCommentSummary(res.data.comment) : null,
      },
    };
  }

  // --- Notifications ---

  async getNotifications(
    query: { updated_after?: string; limit?: number } = {}
  ): Promise<SplitwiseResponse<{ notifications: NotificationSummary[] }>> {
    const res = await this.get<{ notifications?: RawNotification[] }>(
      "/get_notifications",
      query
    );
    return {
      status: res.status,
      data: {
        notifications: (res.data?.notifications ?? []).map(
          toNotificationSummary
        ),
      },
    };
  }

  // --- Currencies & categories ---

  async getCurrencies(
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ currencies: Currency[] }>> {
    const key = cacheKeys.currencies();
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ currencies: Currency[] }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ currencies?: Currency[] }>("/get_currencies");
    const data = { currencies: res.data?.currencies ?? [] };
    if (res.status === 200 && data.currencies.length > 0) {
      await cacheSet(key, CACHE_TTL_METADATA_SEC, data);
    }
    return { status: res.status, data };
  }

  async getCategories(
    opts: ReadOptions = {}
  ): Promise<SplitwiseResponse<{ categories: CategorySummary[] }>> {
    const key = cacheKeys.categories();
    if (!opts.forceRefresh) {
      const hit = await cacheGet<{ categories: CategorySummary[] }>(key);
      if (hit) return { status: 200, data: hit };
    }
    const res = await this.get<{ categories?: RawCategory[] }>(
      "/get_categories"
    );
    const data = {
      categories: (res.data?.categories ?? []).map(toCategorySummary),
    };
    if (res.status === 200 && data.categories.length > 0) {
      await cacheSet(key, CACHE_TTL_METADATA_SEC, data);
    }
    return { status: res.status, data };
  }

  async addUserToGroup(
    payload: AddUserToGroupPayload
  ): Promise<
    SplitwiseResponse<{
      success: boolean;
      user: UserSummary | null;
      errors?: unknown;
    }>
  > {
    const res = await this.post<{
      success: boolean;
      user?: RawUser;
      errors?: unknown;
    }>("/add_user_to_group", payload);
    if (res.data?.success) {
      await cacheDel(cacheKeys.groupById(this.hash, payload.group_id));
      await this.invalidateGroupsAndFriends();
    }
    return {
      status: res.status,
      data: {
        success: res.data?.success ?? false,
        user: res.data?.user ? toUserSummary(res.data.user) : null,
        errors: res.data?.errors,
      },
    };
  }
}

// --- Raw-shape helpers. These describe only the fields we actually read. ---

type RawUser = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  registration_status?: string;
};

type RawMember = RawUser & {
  balance?: Balance[];
};

type RawFriend = RawMember & {
  groups?: { group_id: number; balance?: Balance[] }[];
  updated_at?: string | null;
};

type RawGroup = {
  id: number;
  name: string;
  group_type?: string | null;
  simplify_by_default?: boolean;
  updated_at?: string | null;
  invite_link?: string | null;
  members?: RawMember[];
  original_debts?: Debt[];
  simplified_debts?: Debt[];
};

type RawExpenseShare = {
  user?: RawUser;
  user_id?: number;
  paid_share?: string;
  owed_share?: string;
  net_balance?: string;
};

type RawExpense = {
  id: number;
  group_id?: number | null;
  friendship_id?: number | null;
  description?: string;
  details?: string | null;
  cost?: string;
  currency_code?: string;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  payment?: boolean;
  repeats?: boolean;
  repeat_interval?: string | null;
  comments_count?: number;
  category?: { id?: number; name?: string } | null;
  users?: RawExpenseShare[];
  repayments?: ExpenseRepayment[];
};

type RawComment = {
  id: number;
  content?: string;
  comment_type?: string;
  relation_type?: string;
  relation_id?: number;
  created_at?: string | null;
  deleted_at?: string | null;
  user?: RawUser | null;
};

type RawNotification = {
  id: number;
  type?: number;
  created_at?: string | null;
  created_by?: number | null;
  source?: { type?: string; id?: number; url?: string | null } | null;
  content?: string;
};

type RawCategory = {
  id: number;
  name?: string;
  subcategories?: { id: number; name?: string }[];
};

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].filter((part) => typeof part === "string" && part.length > 0).join(" ");
}

function toUserSummary(u: RawUser): UserSummary {
  const first = u.first_name ?? "";
  const last = u.last_name ?? null;
  return {
    id: u.id,
    first_name: first,
    last_name: last,
    full_name: fullName(first, last) || first || "(unknown)",
    email: u.email ?? null,
    registration_status: u.registration_status as UserSummary["registration_status"],
  };
}

function toMemberSummary(m: RawMember): MemberSummary {
  return {
    ...toUserSummary(m),
    balance: m.balance ?? [],
  };
}

function toFriendSummary(f: RawFriend): FriendSummary {
  return {
    ...toUserSummary(f),
    balance: f.balance ?? [],
    groups: (f.groups ?? []).map((g) => ({
      group_id: g.group_id,
      balance: g.balance ?? [],
    })),
    updated_at: f.updated_at ?? null,
  };
}

function toGroupSummary(g: RawGroup): GroupSummary {
  return {
    id: g.id,
    name: g.name,
    group_type: (g.group_type as SplitwiseGroupType | null | undefined) ?? null,
    simplify_by_default: g.simplify_by_default ?? false,
    updated_at: g.updated_at ?? null,
    invite_link: g.invite_link ?? null,
    members: (g.members ?? []).map(toMemberSummary),
    original_debts: g.original_debts ?? [],
    simplified_debts: g.simplified_debts ?? [],
  };
}

/** `/update_user` has historically returned either `{ user }` or the bare user object. */
function unwrapUser(data: { user?: RawUser } | RawUser | undefined): RawUser | null {
  if (!data) return null;
  if (typeof data === "object" && "user" in data && data.user) return data.user;
  if (typeof data === "object" && "id" in data) return data as RawUser;
  return null;
}

function toExpenseShare(s: RawExpenseShare): ExpenseShare {
  const rawUser = s.user;
  const user = rawUser ? toUserSummary(rawUser) : null;
  return {
    user_id: s.user_id ?? rawUser?.id ?? 0,
    paid_share: s.paid_share ?? "0",
    owed_share: s.owed_share ?? "0",
    net_balance: s.net_balance ?? null,
    user,
  };
}

function toExpenseSummary(e: RawExpense): ExpenseSummary {
  const category =
    e.category && typeof e.category.id === "number"
      ? { id: e.category.id, name: e.category.name ?? "" }
      : null;
  return {
    id: e.id,
    group_id: e.group_id ?? null,
    friendship_id: e.friendship_id ?? null,
    description: e.description ?? "",
    details: e.details ?? null,
    cost: e.cost ?? "0",
    currency_code: e.currency_code ?? "",
    date: e.date ?? null,
    created_at: e.created_at ?? null,
    updated_at: e.updated_at ?? null,
    deleted_at: e.deleted_at ?? null,
    payment: e.payment ?? false,
    repeats: e.repeats ?? false,
    repeat_interval: (e.repeat_interval as RepeatInterval | null) ?? null,
    category,
    users: (e.users ?? []).map(toExpenseShare),
    repayments: e.repayments ?? [],
    comments_count: e.comments_count ?? 0,
  };
}

function toCommentSummary(c: RawComment): CommentSummary {
  return {
    id: c.id,
    content: c.content ?? "",
    comment_type: (c.comment_type as CommentType | undefined) ?? null,
    relation_type: c.relation_type ?? null,
    relation_id: c.relation_id ?? null,
    created_at: c.created_at ?? null,
    deleted_at: c.deleted_at ?? null,
    user: c.user ? toUserSummary(c.user) : null,
  };
}

function toNotificationSummary(n: RawNotification): NotificationSummary {
  const src = n.source;
  return {
    id: n.id,
    type: n.type ?? 0,
    created_at: n.created_at ?? null,
    created_by: n.created_by ?? null,
    source:
      src && typeof src.id === "number" && typeof src.type === "string"
        ? { type: src.type, id: src.id, url: src.url ?? null }
        : null,
    content: n.content ?? "",
  };
}

function toCategorySummary(c: RawCategory): CategorySummary {
  return {
    id: c.id,
    name: c.name ?? "",
    subcategories: (c.subcategories ?? []).map((sc) => ({
      id: sc.id,
      name: sc.name ?? "",
    })),
  };
}

/** Append a `?a=b&c=d` query string to `path`, skipping null/undefined values. */
function appendQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined | null> | undefined
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
