import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveListeningStreak,
  type ListeningStreak,
} from "./listeningStreak.js";

const QUERY_PAGE_SIZE = 1_000;
const AFFIRMATION_TEXT_BATCH_SIZE = 75;
const RECENT_HISTORY_MS = 40 * 24 * 60 * 60 * 1_000;
const RHYTHM_DAY_COUNT = 14;

type NumericValue = number | string | null;

type AffirmationStatRow = {
  affirmation_id: string;
  session_count: NumericValue;
  completed_listens: NumericValue;
  listened_ms: NumericValue;
  last_listened_at: string | null;
};

type RecentSegmentRow = {
  affirmation_id: string;
  session_id: string;
  completed_listens: NumericValue;
  listened_ms: NumericValue;
  started_at: string;
  ended_at: string;
};

type PracticeDayRow = {
  practice_date: string;
};

type LatestSessionRow = {
  timezone_offset_minutes: NumericValue;
};

type AffirmationTextRow = {
  id: string;
  plain_text: string;
};

type QueryResult<T> = {
  rows: T[];
  unavailable: boolean;
};

export type DashboardIdentity = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

export type DashboardAffirmation = {
  id: string;
  text: string;
  sessionCount: number;
  completedListens: number;
  listenedMs: number;
  lastListenedAt: string | null;
};

export type DashboardRecentSegment = {
  affirmationId: string;
  sessionId: string;
  completedListens: number;
  listenedMs: number;
  startedAt: string;
  endedAt: string;
};

export type DashboardSnapshot = {
  identity: Omit<DashboardIdentity, "id">;
  plan: "free" | "premium";
  stats: {
    affirmationsListened: number;
    completedListens: number;
    listenedMs: number;
    latestActivityAt: string | null;
  };
  streak: ListeningStreak | null;
  rhythm: number[];
  affirmations: DashboardAffirmation[];
  recentSegments: DashboardRecentSegment[];
  historyPeriodsAvailable: boolean;
  dataUnavailable: boolean;
  generatedAt: string;
};

function numeric(value: NumericValue | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: NumericValue | undefined): number {
  return Math.max(0, Math.floor(numeric(value)));
}

function displayText(value: string): string {
  return value.replace(/^\s*\[affirmation\]\s*/iu, "").trim();
}

function laterTimestamp(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

async function loadAffirmationStats(
  client: SupabaseClient,
  userId: string,
): Promise<QueryResult<AffirmationStatRow>> {
  const rows: AffirmationStatRow[] = [];

  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await client
      .from("user_affirmation_listening_stats")
      .select(
        "affirmation_id, session_count, completed_listens, listened_ms, last_listened_at",
      )
      .eq("user_id", userId)
      .order("last_listened_at", { ascending: false })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);

    if (error) return { rows, unavailable: true };
    const page = (data ?? []) as AffirmationStatRow[];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) {
      return { rows, unavailable: false };
    }
  }
}

async function loadRecentSegments(
  client: SupabaseClient,
  userId: string,
): Promise<QueryResult<RecentSegmentRow>> {
  const historyStart = new Date(Date.now() - RECENT_HISTORY_MS).toISOString();
  const rows: RecentSegmentRow[] = [];

  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await client
      .from("user_listening_segments")
      .select(
        "affirmation_id, session_id, completed_listens, listened_ms, started_at, ended_at",
      )
      .eq("user_id", userId)
      .gte("started_at", historyStart)
      .order("started_at", { ascending: false })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);

    if (error) return { rows, unavailable: true };
    const page = (data ?? []) as RecentSegmentRow[];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) {
      return { rows, unavailable: false };
    }
  }
}

async function loadPracticeDays(
  client: SupabaseClient,
  userId: string,
): Promise<QueryResult<PracticeDayRow>> {
  const rows: PracticeDayRow[] = [];

  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await client
      .from("user_daily_listening_stats")
      .select("practice_date")
      .eq("user_id", userId)
      .order("practice_date", { ascending: false })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);

    if (error) return { rows, unavailable: true };
    const page = (data ?? []) as PracticeDayRow[];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) {
      return { rows, unavailable: false };
    }
  }
}

async function loadAffirmationText(
  client: SupabaseClient,
  affirmationIds: string[],
): Promise<QueryResult<AffirmationTextRow>> {
  const rows: AffirmationTextRow[] = [];

  for (
    let offset = 0;
    offset < affirmationIds.length;
    offset += AFFIRMATION_TEXT_BATCH_SIZE
  ) {
    const ids = affirmationIds.slice(
      offset,
      offset + AFFIRMATION_TEXT_BATCH_SIZE,
    );
    const { data, error } = await client
      .from("affirmations")
      .select("id, plain_text")
      .in("id", ids);

    if (error) return { rows, unavailable: true };
    rows.push(...((data ?? []) as AffirmationTextRow[]));
  }

  return { rows, unavailable: false };
}

function listeningRhythm(segments: RecentSegmentRow[]): number[] {
  const days = Array.from({ length: RHYTHM_DAY_COUNT }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (RHYTHM_DAY_COUNT - 1 - index));
    return date;
  });
  const bucketByDate = new Map(
    days.map((date, index) => [localDateKey(date), index]),
  );
  const buckets = Array.from({ length: RHYTHM_DAY_COUNT }, () => 0);

  for (const segment of segments) {
    const startedAt = new Date(segment.started_at);
    if (Number.isNaN(startedAt.getTime())) continue;
    const index = bucketByDate.get(localDateKey(startedAt));
    if (index === undefined) continue;
    buckets[index] = (buckets[index] ?? 0) + integer(segment.listened_ms);
  }

  return buckets;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export async function loadDashboardSnapshot(
  client: SupabaseClient,
  identity: DashboardIdentity,
  plan: "free" | "premium",
): Promise<DashboardSnapshot> {
  const [statResult, segmentResult, practiceDayResult, latestSessionResult] =
    await Promise.all([
      loadAffirmationStats(client, identity.id),
      loadRecentSegments(client, identity.id),
      loadPracticeDays(client, identity.id),
      client
        .from("user_listening_session_summaries")
        .select("timezone_offset_minutes")
        .eq("user_id", identity.id)
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  if (statResult.unavailable) {
    throw new Error("Listening statistics are temporarily unavailable.");
  }

  const textResult = await loadAffirmationText(
    client,
    statResult.rows.map((row) => row.affirmation_id),
  );
  const textById = new Map(
    textResult.rows.map((row) => [row.id, displayText(row.plain_text)]),
  );
  const affirmations = statResult.rows
    .map((row): DashboardAffirmation => ({
      id: row.affirmation_id,
      text:
        textById.get(row.affirmation_id) ??
        "An affirmation you listened to",
      sessionCount: integer(row.session_count),
      completedListens: integer(row.completed_listens),
      listenedMs: integer(row.listened_ms),
      lastListenedAt: row.last_listened_at,
    }))
    .sort(
      (left, right) =>
        right.completedListens - left.completedListens ||
        right.listenedMs - left.listenedMs ||
        (right.lastListenedAt ?? "").localeCompare(
          left.lastListenedAt ?? "",
        ),
    );

  let latestActivityAt: string | null = null;
  for (const affirmation of affirmations) {
    latestActivityAt = laterTimestamp(
      latestActivityAt,
      affirmation.lastListenedAt,
    );
  }

  const latestSessionRows = (latestSessionResult.data ??
    []) as LatestSessionRow[];
  const timezoneOffsetMinutes =
    latestSessionRows.length > 0
      ? numeric(latestSessionRows[0]?.timezone_offset_minutes)
      : new Date().getTimezoneOffset();
  const streak =
    practiceDayResult.unavailable || latestSessionResult.error
      ? null
      : deriveListeningStreak(
          practiceDayResult.rows.map((row) => row.practice_date),
          new Date(),
          timezoneOffsetMinutes,
        );

  return {
    identity: {
      displayName: identity.displayName,
      username: identity.username,
      avatarUrl: identity.avatarUrl,
    },
    plan,
    stats: {
      affirmationsListened: affirmations.filter(
        (affirmation) => affirmation.completedListens > 0,
      ).length,
      completedListens: affirmations.reduce(
        (total, affirmation) => total + affirmation.completedListens,
        0,
      ),
      listenedMs: affirmations.reduce(
        (total, affirmation) => total + affirmation.listenedMs,
        0,
      ),
      latestActivityAt,
    },
    streak,
    rhythm: listeningRhythm(segmentResult.rows),
    affirmations,
    recentSegments: segmentResult.rows.map((segment) => ({
      affirmationId: segment.affirmation_id,
      sessionId: segment.session_id,
      completedListens: integer(segment.completed_listens),
      listenedMs: integer(segment.listened_ms),
      startedAt: segment.started_at,
      endedAt: segment.ended_at,
    })),
    historyPeriodsAvailable: !segmentResult.unavailable,
    dataUnavailable:
      segmentResult.unavailable ||
      practiceDayResult.unavailable ||
      Boolean(latestSessionResult.error) ||
      textResult.unavailable,
    generatedAt: new Date().toISOString(),
  };
}
