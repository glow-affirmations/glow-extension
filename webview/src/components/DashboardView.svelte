<script lang="ts">
  import { onMount } from "svelte";
  import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
  import ArrowUpIcon from "phosphor-svelte/lib/ArrowUpIcon";
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import FunnelSimpleIcon from "phosphor-svelte/lib/FunnelSimpleIcon";
  import ShareNetworkIcon from "phosphor-svelte/lib/ShareNetworkIcon";
  import UsersThreeIcon from "phosphor-svelte/lib/UsersThreeIcon";
  import AffirmationShareDialog from "./AffirmationShareDialog.svelte";
  import ProgressShareDialog from "./ProgressShareDialog.svelte";
  import GlowMark from "./GlowMark.svelte";
  import Icon from "./Icon.svelte";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import type { ProgressSharePoint, ProgressShareSummary } from "$lib/share-card";
  import type {
    DashboardAffirmation,
    DashboardHostApi,
    DashboardSnapshot,
    DashboardToExtensionMessage,
    DashboardViewState,
    ExtensionToDashboardMessage,
  } from "$lib/host";

  let { hostApi: vscode }: { hostApi: DashboardHostApi } = $props();
  const REFRESH_INTERVAL_MS = 60_000;
  const VISIBLE_TABLE_ROWS = 5;
  const DASHBOARD_PREFERENCES_KEY = "glow.dashboard.preferences.v1";
  type HistoryPeriod = "today" | "week" | "month" | "all";
  type AffirmationSort = "completed" | "listened" | "sessions" | "recent" | "affirmation";
  type SortDirection = "asc" | "desc";
  type DashboardPreferences = {
    period?: HistoryPeriod;
    sort?: AffirmationSort;
    direction?: SortDirection;
  };
  type PeriodAggregate = Omit<DashboardAffirmation, "sessionCount"> & {
    sessionIds: Set<string>;
  };
  const HISTORY_PERIODS = ["today", "week", "month", "all"] as const;
  const AFFIRMATION_SORTS = ["completed", "listened", "sessions", "recent", "affirmation"] as const;
  const SORT_LABELS: Record<AffirmationSort, string> = {
    completed: "Times affirmed",
    listened: "Listening time",
    sessions: "Sessions",
    recent: "Last practiced",
    affirmation: "Affirmation",
  };

  let viewState = $state<DashboardViewState>({ status: "loading" });
  let refreshing = $state(false);
  let historyPeriod = $state<HistoryPeriod>("all");
  let affirmationSort = $state<AffirmationSort>("listened");
  let sortDirection = $state<SortDirection>("desc");
  let shareAffirmationId = $state<string | null>(null);
  let sharePeriod = $state<HistoryPeriod>("all");
  let progressShareOpen = $state(false);
  let progressSharePeriod = $state<HistoryPeriod>("all");
  const readyData = $derived(
    viewState.status === "ready" ? viewState.data : null,
  );
  const rhythmDays = $derived.by(() =>
    recentRhythmDays(readyData?.rhythm.length ?? 0),
  );
  const selectedHistoryPeriod = $derived(
    readyData?.historyPeriodsAvailable ? historyPeriod : "all",
  );
  const mostPracticed = $derived(
    readyData?.affirmations.find(
      (affirmation) => affirmation.completedListens > 0,
    ) ?? null,
  );
  const maximumRhythm = $derived(Math.max(...(readyData?.rhythm ?? []), 0));

  function recentRhythmDays(count: number): Array<{ short: string; long: string }> {
    return Array.from({ length: count }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (count - 1 - index));
      return {
        short: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
        long: new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        }).format(date),
      };
    });
  }
  const periodAffirmations = $derived.by(() =>
    readyData ? affirmationsForPeriod(readyData, selectedHistoryPeriod) : [],
  );
  const sortedAffirmations = $derived.by(() =>
    [...periodAffirmations].sort((left, right) => {
      let comparison = 0;
      if (affirmationSort === "completed") comparison = left.completedListens - right.completedListens;
      if (affirmationSort === "listened") comparison = left.listenedMs - right.listenedMs;
      if (affirmationSort === "sessions") comparison = left.sessionCount - right.sessionCount;
      if (affirmationSort === "recent") {
        comparison = (left.lastListenedAt ? Date.parse(left.lastListenedAt) : 0) -
          (right.lastListenedAt ? Date.parse(right.lastListenedAt) : 0);
      }
      if (affirmationSort === "affirmation") {
        comparison = left.text.localeCompare(right.text, undefined, { sensitivity: "base" });
      }
      if (comparison === 0) {
        comparison = left.text.localeCompare(right.text, undefined, { sensitivity: "base" });
      }
      return sortDirection === "asc" ? comparison : -comparison;
    }),
  );
  const shareAffirmation = $derived.by((): DashboardAffirmation | null => {
    if (!readyData || !shareAffirmationId) return null;
    const allTime = readyData.affirmations.find(({ id }) => id === shareAffirmationId);
    if (!allTime) return null;
    if (sharePeriod === "all") return allTime;
    return affirmationsForPeriod(readyData, sharePeriod).find(({ id }) => id === shareAffirmationId) ?? {
      ...allTime,
      sessionCount: 0,
      completedListens: 0,
      listenedMs: 0,
      lastListenedAt: null,
    };
  });
  const progressShareSummary = $derived.by(() =>
    readyData
      ? buildProgressShareSummary(readyData, progressSharePeriod)
      : emptyProgressShareSummary(progressSharePeriod),
  );
  const accountInitial = $derived(
    readyData?.identity.displayName.slice(0, 1).toUpperCase() || "G",
  );

  onMount(() => {
    let lastRefreshAt = Date.now();
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(DASHBOARD_PREFERENCES_KEY) ?? "{}",
      ) as DashboardPreferences;
      if (isHistoryPeriod(saved.period)) historyPeriod = saved.period;
      if (isAffirmationSort(saved.sort)) affirmationSort = saved.sort;
      if (saved.direction === "asc" || saved.direction === "desc") sortDirection = saved.direction;
    } catch {
      // Preferences are optional when webview storage is unavailable.
    }

    const handleMessage = (
      event: MessageEvent<ExtensionToDashboardMessage>,
    ) => {
      if (event.data.type !== "dashboardState") return;
      viewState = event.data.state;
      refreshing = false;
      lastRefreshAt = Date.now();
    };
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        vscode.postMessage({ type: "refreshDashboard" });
      }
    }, REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (!document.hidden && Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        vscode.postMessage({ type: "refreshDashboard" });
      }
    };
    const closeMenusOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(".dashboard-dropdown[open]")) {
        if (!menu.contains(event.target)) menu.removeAttribute("open");
      }
    };
    const closeMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(".dashboard-dropdown[open]")) {
        menu.removeAttribute("open");
        menu.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    document.addEventListener("click", closeMenusOnOutsideClick);
    document.addEventListener("keydown", closeMenusOnEscape);
    vscode.postMessage({ type: "dashboardReady" });
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      document.removeEventListener("click", closeMenusOnOutsideClick);
      document.removeEventListener("keydown", closeMenusOnEscape);
    };
  });

  function refreshDashboard(): void {
    if (refreshing) return;
    refreshing = true;
    vscode.postMessage({ type: "refreshDashboard" });
  }

  function runMenuAction(
    event: MouseEvent,
    message: DashboardToExtensionMessage,
  ): void {
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
    vscode.postMessage(message);
  }

  function openShareDialog(affirmation: DashboardAffirmation): void {
    shareAffirmationId = affirmation.id;
    sharePeriod = selectedHistoryPeriod;
  }

  function closeShareDialog(): void {
    shareAffirmationId = null;
  }

  function savePreferences(): void {
    try {
      window.localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify({
        period: historyPeriod,
        sort: affirmationSort,
        direction: sortDirection,
      }));
    } catch {
      // Preferences are an enhancement.
    }
  }

  function isHistoryPeriod(value: unknown): value is HistoryPeriod {
    return HISTORY_PERIODS.some((period) => period === value);
  }

  function isAffirmationSort(value: unknown): value is AffirmationSort {
    return AFFIRMATION_SORTS.some((sort) => sort === value);
  }

  function chooseHistoryPeriod(period: HistoryPeriod): void {
    if (period !== "all" && !readyData?.historyPeriodsAvailable) return;
    historyPeriod = period;
    savePreferences();
  }

  function chooseSharePeriod(period: HistoryPeriod): void {
    if (period !== "all" && !readyData?.historyPeriodsAvailable) return;
    sharePeriod = period;
  }

  function openProgressShare(): void {
    progressSharePeriod = selectedHistoryPeriod;
    progressShareOpen = true;
  }

  function chooseProgressSharePeriod(period: HistoryPeriod): void {
    if (period !== "all" && !readyData?.historyPeriodsAvailable) return;
    progressSharePeriod = period;
  }

  function chooseSort(sort: AffirmationSort, event: MouseEvent): void {
    affirmationSort = sort;
    sortDirection = sort === "affirmation" ? "asc" : "desc";
    savePreferences();
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  }

  function toggleSortDirection(event: MouseEvent): void {
    sortDirection = sortDirection === "desc" ? "asc" : "desc";
    savePreferences();
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  }

  function handleHistoryPeriodKeydown(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const available: readonly HistoryPeriod[] = readyData?.historyPeriodsAvailable
      ? HISTORY_PERIODS
      : ["all"];
    const currentIndex = available.indexOf(selectedHistoryPeriod);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = available.length - 1;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + available.length) % available.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % available.length;
    const nextPeriod = available[nextIndex];
    chooseHistoryPeriod(nextPeriod);
    document.getElementById(`dashboard-period-${nextPeriod}`)?.focus();
  }

  function historyPeriodStart(period: Exclude<HistoryPeriod, "all">): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === "week") start.setDate(start.getDate() - 6);
    if (period === "month") start.setDate(start.getDate() - 29);
    return start.getTime();
  }

  function affirmationsForPeriod(data: DashboardSnapshot, period: HistoryPeriod): DashboardAffirmation[] {
    if (period === "all") return data.affirmations;
    const startAt = historyPeriodStart(period);
    const textById = new Map(data.affirmations.map(({ id, text }) => [id, text]));
    const aggregates = new Map<string, PeriodAggregate>();
    for (const segment of data.recentSegments) {
      const startedAt = Date.parse(segment.startedAt);
      if (!Number.isFinite(startedAt) || startedAt < startAt) continue;
      const lastListenedAt = segment.endedAt || segment.startedAt;
      const existing = aggregates.get(segment.affirmationId);
      if (existing) {
        existing.sessionIds.add(segment.sessionId);
        existing.completedListens += segment.completedListens;
        existing.listenedMs += segment.listenedMs;
        if (!existing.lastListenedAt || Date.parse(lastListenedAt) > Date.parse(existing.lastListenedAt)) {
          existing.lastListenedAt = lastListenedAt;
        }
      } else {
        aggregates.set(segment.affirmationId, {
          id: segment.affirmationId,
          text: textById.get(segment.affirmationId) ?? "An affirmation you listened to",
          sessionIds: new Set([segment.sessionId]),
          completedListens: segment.completedListens,
          listenedMs: segment.listenedMs,
          lastListenedAt,
        });
      }
    }
    return Array.from(aggregates.values(), ({ sessionIds, ...affirmation }) => ({
      ...affirmation,
      sessionCount: sessionIds.size,
    }));
  }

  function timelinePoints(data: DashboardSnapshot, period: Exclude<HistoryPeriod, "all">): ProgressSharePoint[] {
    const startAt = historyPeriodStart(period);
    if (period === "today") {
      const buckets = Array.from({ length: 8 }, (_, index) => ({
        label: index === 0 ? "12a" : index === 4 ? "12p" : `${(index * 3) % 12 || 12}${index < 4 ? "a" : "p"}`,
        listenedMs: 0,
      }));
      for (const segment of data.recentSegments) {
        const date = new Date(segment.startedAt);
        if (Number.isNaN(date.getTime()) || date.getTime() < startAt) continue;
        buckets[Math.min(7, Math.floor(date.getHours() / 3))].listenedMs += segment.listenedMs;
      }
      return buckets;
    }
    const bucketDays = period === "week" ? 1 : 3;
    const count = period === "week" ? 7 : 10;
    const buckets = Array.from({ length: count }, (_, index) => {
      const date = new Date(startAt);
      date.setDate(date.getDate() + index * bucketDays);
      return {
        label: period === "week"
          ? new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date)
          : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
        listenedMs: 0,
      };
    });
    for (const segment of data.recentSegments) {
      const date = new Date(segment.startedAt);
      if (Number.isNaN(date.getTime()) || date.getTime() < startAt) continue;
      date.setHours(0, 0, 0, 0);
      const dayOffset = Math.max(0, Math.round((date.getTime() - startAt) / 86_400_000));
      buckets[Math.min(count - 1, Math.floor(dayOffset / bucketDays))].listenedMs += segment.listenedMs;
    }
    return buckets;
  }

  function affirmationMix(affirmations: DashboardAffirmation[]): ProgressSharePoint[] {
    const sorted = affirmations.filter(({ listenedMs }) => listenedMs > 0)
      .sort((left, right) => right.listenedMs - left.listenedMs);
    if (sorted.length <= 8) return sorted.map(({ text, listenedMs }) => ({ label: text, listenedMs }));
    return [
      ...sorted.slice(0, 7).map(({ text, listenedMs }) => ({ label: text, listenedMs })),
      { label: `${sorted.length - 7} more affirmations`, listenedMs: sorted.slice(7).reduce((sum, item) => sum + item.listenedMs, 0) },
    ];
  }

  function emptyProgressShareSummary(period: HistoryPeriod): ProgressShareSummary {
    const labels: Record<HistoryPeriod, string> = {
      today: "Today", week: "Last 7 days", month: "Last 30 days", all: "All-time practice",
    };
    return { period, periodLabel: labels[period], listenedMs: 0, completedListens: 0, affirmationCount: 0, chartKind: period === "all" ? "affirmations" : "timeline", points: [] };
  }

  function buildProgressShareSummary(data: DashboardSnapshot, period: HistoryPeriod): ProgressShareSummary {
    const affirmations = affirmationsForPeriod(data, period).filter(
      ({ listenedMs, completedListens }) => listenedMs > 0 || completedListens > 0,
    );
    const summary = emptyProgressShareSummary(period);
    return {
      ...summary,
      listenedMs: affirmations.reduce((sum, item) => sum + item.listenedMs, 0),
      completedListens: affirmations.reduce((sum, item) => sum + item.completedListens, 0),
      affirmationCount: affirmations.length,
      points: period === "all" ? affirmationMix(affirmations) : timelinePoints(data, period),
    };
  }

  function formatDuration(milliseconds: number): string {
    const totalMinutes = Math.round(milliseconds / 60_000);
    if (totalMinutes < 1) return milliseconds > 0 ? "< 1 min" : "0 min";
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
  }

  function formatCount(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  function formatShortDate(value: string | null): string {
    if (!value) return "No activity";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No activity";

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activityDay = new Date(date);
    activityDay.setHours(0, 0, 0, 0);
    const daysAgo = Math.round(
      (today.getTime() - activityDay.getTime()) / 86_400_000,
    );

    if (daysAgo === 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    }).format(date);
  }

  function formatUpdatedAt(value: string): string {
    const date = new Date(value);
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
</script>

<svelte:head>
  <title>Dashboard</title>
  <meta
    name="description"
    content="Your affirmation listening progress inside VS Code"
  />
</svelte:head>

{#if viewState.status === "loading"}
  <main class="center-state" aria-live="polite">
    <LoadingSpinner />
    <strong>Loading your practice</strong>
  </main>
{:else if viewState.status === "signed_out"}
  <main class="center-state">
    <span class="state-mark" aria-hidden="true"><GlowMark /></span>
    <strong>Sign in to see your dashboard</strong>
    <p>Your listening progress will appear here after Glow is connected.</p>
    <button
      class="primary-button"
      type="button"
      onclick={() => vscode.postMessage({ type: "focusGlow" })}
    >
      Open Glow
    </button>
  </main>
{:else if viewState.status === "error"}
  <main class="center-state" role="alert">
    <span class="state-icon" aria-hidden="true">
      <Icon name="warning" size="prominent" weight="duotone" />
    </span>
    <strong>Dashboard unavailable</strong>
    <p>{viewState.message}</p>
    <button class="primary-button" type="button" onclick={refreshDashboard}>
      Try again
    </button>
  </main>
{:else}
  <main class="dashboard-shell">
    <nav class="dashboard-nav" aria-label="Glow dashboard">
      <div class="brand-cluster">
        <span class="brand-mark" aria-hidden="true"><GlowMark /></span>
        <strong>Glow</strong>
        {#if viewState.data.plan === "premium"}
          <span class="plan-badge">Premium</span>
        {/if}
      </div>

      <div class="nav-actions">
        <button
          class="icon-button"
          class:spinning={refreshing}
          type="button"
          aria-label="Refresh dashboard"
          title="Refresh"
          disabled={refreshing}
          onclick={refreshDashboard}
        >
          <Icon name="regenerate" />
        </button>
        <details class="dashboard-dropdown account-menu">
          <summary
            class="profile-trigger"
            aria-label={`Open account menu for ${viewState.data.identity.displayName}`}
          >
            {#if viewState.data.identity.avatarUrl}
              <img
                src={viewState.data.identity.avatarUrl}
                alt=""
                width="34"
                height="34"
                referrerpolicy="no-referrer"
              />
            {:else}
              <span class="nav-avatar-fallback" aria-hidden="true">{accountInitial}</span>
            {/if}
          </summary>
          <div class="account-menu-panel">
            <button type="button" onclick={(event) => runMenuAction(event, { type: "openCommunity" })}>
              <span>Community</span>
              <UsersThreeIcon size={16} weight="duotone" />
            </button>
            <button type="button" onclick={(event) => runMenuAction(event, { type: "openDashboardOnWeb" })}>
              <span>Open on the web</span>
              <Icon name="external" />
            </button>
            {#if viewState.data.plan === "premium"}
              <button type="button" onclick={(event) => runMenuAction(event, { type: "openBilling" })}>
                <span>Manage billing</span>
                <Icon name="billing" />
              </button>
            {:else}
              <button type="button" onclick={(event) => runMenuAction(event, { type: "openPremium" })}>
                <span>Explore Premium</span>
                <Icon name="arrow" size="small" weight="bold" />
              </button>
            {/if}
          </div>
        </details>
      </div>
    </nav>

    <header class="dashboard-heading">
      <div>
        <h1>{viewState.data.identity.displayName}</h1>
        {#if viewState.data.identity.username}
          <span>@{viewState.data.identity.username}</span>
        {/if}
      </div>
      <p>
        Updated {formatUpdatedAt(viewState.data.generatedAt)}
      </p>
    </header>

    {#if viewState.data.dataUnavailable}
      <p class="status-note" role="status">
        Some recent details are temporarily unavailable. The rest of your
        practice is still here.
      </p>
    {/if}

    <section class="metrics" aria-label="Listening overview">
      <div>
        <span>Listening time</span>
        <strong>{formatDuration(viewState.data.stats.listenedMs)}</strong>
      </div>
      <div>
        <span>Times affirmed</span>
        <strong>{formatCount(viewState.data.stats.completedListens)}</strong>
      </div>
      <div>
        <span>Affirmations</span>
        <strong>{formatCount(viewState.data.stats.affirmationsListened)}</strong
        >
      </div>
      <div>
        <span class="streak-label">
          <Icon name="fire" size="small" weight="duotone" />
          Current streak
        </span>
        <strong>
          {viewState.data.streak === null
            ? "Unavailable"
            : `${formatCount(viewState.data.streak.currentDays)} ${
                viewState.data.streak.currentDays === 1 ? "day" : "days"
              }`}
        </strong>
      </div>
    </section>

    {#if viewState.data.affirmations.length > 0}
      <div class="summary-grid">
        <section class="summary-panel" aria-labelledby="most-practiced-title">
          <p id="most-practiced-title" class="summary-label">Most listened</p>
          {#if mostPracticed}
            <h2>{mostPracticed.text}</h2>
            <p>
              <strong>{formatCount(mostPracticed.completedListens)}</strong>
              {mostPracticed.completedListens === 1
                ? "time affirmed"
                : "times affirmed"}
              <span>{formatDuration(mostPracticed.listenedMs)}</span>
            </p>
          {:else}
            <h2>Your first repetition will appear here.</h2>
          {/if}
        </section>

        <section
          class="summary-panel rhythm-panel"
          aria-label="Daily listening rhythm"
        >
          <div class="rhythm-chart" aria-label="Listening time grouped by weekday">
            {#each viewState.data.rhythm as listenedMs, index}
              <span
                class="rhythm-column"
                title={`${rhythmDays[index]?.long ?? "Day"}: ${formatDuration(listenedMs)}`}
                aria-label={`${rhythmDays[index]?.long ?? "Day"}: ${formatDuration(listenedMs)}`}
              >
                <i
                  style={`--bar-height: ${maximumRhythm === 0 ? 0 : listenedMs / maximumRhythm}; --bar-min-height: ${listenedMs > 0 ? 4 : 0}px`}
                ></i>
              </span>
            {/each}
          </div>
          <div class="rhythm-axis" aria-hidden="true">
            {#each rhythmDays as day}
              <span>{day.short}</span>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    <section class="history-section" aria-labelledby="history-title">
      <header class="history-header">
        <h2 id="history-title">History</h2>
        <div class="history-controls">
          <div class="period-switch" role="tablist" aria-label="Listening period">
            <span class="period-indicator" data-selected={selectedHistoryPeriod} aria-hidden="true"></span>
            {#each [
              { id: "today", label: "Today" },
              { id: "week", label: "Week" },
              { id: "month", label: "Month" },
              { id: "all", label: "All time" },
            ] as option (option.id)}
              <button
                id={`dashboard-period-${option.id}`}
                type="button"
                role="tab"
                aria-selected={selectedHistoryPeriod === option.id}
                aria-controls="dashboard-affirmation-history"
                tabindex={selectedHistoryPeriod === option.id ? 0 : -1}
                disabled={option.id !== "all" && !viewState.data.historyPeriodsAvailable}
                onclick={() => chooseHistoryPeriod(option.id as HistoryPeriod)}
                onkeydown={handleHistoryPeriodKeydown}
              >{option.label}</button>
            {/each}
          </div>
          <button
            class="history-share-trigger"
            type="button"
            aria-label={`Share ${selectedHistoryPeriod === "all" ? "all-time" : selectedHistoryPeriod} progress`}
            title="Share progress"
            onclick={openProgressShare}
          >
            <ShareNetworkIcon size={16} weight="bold" />
          </button>
          <details class="dashboard-dropdown sort-dropdown">
            <summary
              class="sort-trigger"
              aria-label={`Sort affirmations, currently by ${SORT_LABELS[affirmationSort]}`}
              title={`Sort by ${SORT_LABELS[affirmationSort]}`}
            >
              <FunnelSimpleIcon size={16} weight="bold" />
            </summary>
            <div class="sort-menu">
              <p>Sort by</p>
              {#each AFFIRMATION_SORTS as sort (sort)}
                <button
                  type="button"
                  aria-pressed={affirmationSort === sort}
                  onclick={(event) => chooseSort(sort, event)}
                >
                  <span>{SORT_LABELS[sort]}</span>
                  {#if affirmationSort === sort}<CheckIcon size={14} weight="bold" />{/if}
                </button>
              {/each}
              <button class="sort-direction-option" type="button" onclick={toggleSortDirection}>
                <span>{sortDirection === "desc" ? "Descending" : "Ascending"}</span>
                {#if sortDirection === "desc"}
                  <ArrowDownIcon size={14} weight="bold" />
                {:else}
                  <ArrowUpIcon size={14} weight="bold" />
                {/if}
              </button>
            </div>
          </details>
        </div>
      </header>

      <div id="dashboard-affirmation-history" role="tabpanel">
      {#if sortedAffirmations.length > 0}
        <div class="listening-table-wrap">
          <div class="listening-table" role="table" aria-label="Affirmations">
            <div class="table-header" role="row">
              <span role="columnheader">Affirmation</span>
              <span role="columnheader">Listened</span>
              <span role="columnheader">Sessions</span>
              <span role="columnheader">Times affirmed</span>
              <span role="columnheader">Last practiced</span>
            </div>
            <div class="table-body" role="rowgroup">
              {#each sortedAffirmations as affirmation, index (affirmation.id)}
                <div class="table-row" role="row" style={`--row-index: ${Math.min(index, 4)}`}>
                  <div class="affirmation-cell" role="rowheader">
                    <strong>{affirmation.text}</strong>
                    <button
                      class="row-share-button"
                      type="button"
                      aria-label={`Share progress for ${affirmation.text}`}
                      title="Share progress"
                      onclick={() => openShareDialog(affirmation)}
                    >
                      <ShareNetworkIcon size={16} weight="bold" />
                    </button>
                  </div>
                  <span role="cell"
                    >{formatDuration(affirmation.listenedMs)}</span
                  >
                  <span role="cell"
                    >{formatCount(affirmation.sessionCount)}</span
                  >
                  <span role="cell"
                    >{formatCount(affirmation.completedListens)}</span
                  >
                  <span role="cell"
                    >{formatShortDate(affirmation.lastListenedAt)}</span
                  >
                </div>
              {/each}
              {#each Array.from({ length: Math.max(0, VISIBLE_TABLE_ROWS - sortedAffirmations.length) }, (_, index) => index) as index (`placeholder-${index}`)}
                <div class="table-row table-row-placeholder" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <div class="empty-state">
          {#if viewState.data.affirmations.length > 0}
            <p>No affirmation listening in this period.</p>
          {:else}
            <span class="state-icon" aria-hidden="true">
              <Icon name="waveform" size="prominent" weight="duotone" />
            </span>
            <strong>Your practice starts in Glow</strong>
            <p>Play an affirmation and your listening progress will appear here.</p>
            <button
              class="secondary-button"
              type="button"
              onclick={() => vscode.postMessage({ type: "focusGlow" })}
            >Open Glow</button>
          {/if}
        </div>
      {/if}
      </div>
    </section>

    <footer class="community-footer">
      <div class="community-identity">
        <UsersThreeIcon size={18} weight="duotone" aria-hidden="true" />
        <span>Share what is helping you grow</span>
      </div>
      <button type="button" onclick={() => vscode.postMessage({ type: "openCommunity" })}>
        <span>Explore the community</span>
        <Icon name="arrow" size="small" weight="bold" />
      </button>
    </footer>

    <AffirmationShareDialog
      open={shareAffirmationId !== null}
      affirmation={shareAffirmation}
      displayName={viewState.data.identity.displayName}
      period={sharePeriod}
      streakDays={viewState.data.streak?.currentDays ?? null}
      historyPeriodsAvailable={viewState.data.historyPeriodsAvailable}
      onClose={closeShareDialog}
      onPeriodChange={chooseSharePeriod}
    />
    <ProgressShareDialog
      open={progressShareOpen}
      summary={progressShareSummary}
      displayName={viewState.data.identity.displayName}
      streakDays={viewState.data.streak?.currentDays ?? null}
      historyPeriodsAvailable={viewState.data.historyPeriodsAvailable}
      onClose={() => (progressShareOpen = false)}
      onPeriodChange={chooseProgressSharePeriod}
    />
  </main>
{/if}

<style>
  :global(html[data-glow-view="dashboard"]),
  :global(html[data-glow-view="dashboard"] body) {
    min-height: 100%;
    overflow: auto;
  }

  :global(html[data-glow-view="dashboard"] body) {
    background: var(--sol-panel);
  }

  :global(html[data-glow-view="dashboard"] body::before) {
    display: none;
  }

  button {
    border: 0;
  }

  .dashboard-shell {
    width: min(1160px, calc(100% - 48px));
    margin: 0 auto;
    padding: 20px 0 48px;
    --dashboard-bg: var(--sol-panel);
    --dashboard-panel: var(--sol-surface);
    --dashboard-text: var(--sol-text);
    --dashboard-muted: var(--sol-muted);
    --dashboard-border: var(--sol-border);
    --dashboard-rule: var(--sol-rule);
    --dashboard-accent: var(--sol-accent);
    --dashboard-accent-hover: var(--sol-accent-hover);
    --dashboard-button-fg: var(--sol-button-fg);
    --dashboard-control-bg: var(--sol-control-bg);
    --dashboard-row-active-border: var(--sol-row-active-border);
    --glow-font-display: var(--sol-font-brand);
    --glow-motion-feedback: var(--sol-motion-feedback);
    --glow-motion-press: var(--sol-motion-press);
    --glow-motion-ease: var(--sol-motion-ease);
    --glow-press-scale: var(--sol-press-scale);
  }

  .dashboard-nav {
    display: flex;
    min-height: 50px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-bottom: 1px solid var(--sol-rule);
  }

  .brand-cluster,
  .nav-actions,
  .streak-label {
    display: flex;
    align-items: center;
  }

  .brand-cluster {
    gap: 10px;
  }

  .brand-mark {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    filter: var(--sol-brand-shadow);
  }

  .brand-cluster strong {
    font-family: var(--sol-font-brand);
    font-size: 17px;
  }

  .plan-badge {
    padding: 2px 7px;
    border: 1px solid color-mix(in srgb, var(--sol-accent) 42%, transparent);
    border-radius: var(--sol-radius-compact);
    color: var(--sol-accent);
    background: color-mix(in srgb, var(--sol-accent) 9%, transparent);
    font-size: 10px;
    font-weight: var(--sol-weight-semibold);
  }

  .nav-actions {
    gap: 6px;
  }

  .icon-button {
    display: grid;
    height: 34px;
    align-items: center;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-compact);
    color: var(--sol-muted);
    background: var(--sol-control-bg);
    cursor: pointer;
  }

  .icon-button {
    width: 34px;
    place-items: center;
  }

  .icon-button:hover:not(:disabled),
  .icon-button:focus-visible {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .icon-button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .icon-button.spinning :global(svg) {
    animation: spin 700ms linear infinite;
  }

  .dashboard-dropdown {
    position: relative;
  }

  .dashboard-dropdown > summary {
    list-style: none;
    outline: none;
  }

  .dashboard-dropdown > summary::-webkit-details-marker {
    display: none;
  }

  .dashboard-dropdown > summary:focus-visible {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sol-focus) 28%, transparent);
  }

  .profile-trigger {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    transition:
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .profile-trigger:hover,
  .account-menu[open] .profile-trigger {
    border-color: var(--sol-border);
    background: var(--sol-control-bg);
  }

  .profile-trigger img,
  .nav-avatar-fallback {
    width: 34px;
    height: 34px;
    border: 1px solid var(--sol-border);
    border-radius: 50%;
  }

  .profile-trigger img {
    display: block;
    object-fit: cover;
  }

  .nav-avatar-fallback {
    display: grid;
    place-items: center;
    background: var(--sol-row-active);
    color: var(--sol-accent);
    font-family: var(--sol-font-brand);
    font-weight: var(--sol-weight-semibold);
  }

  .account-menu-panel,
  .sort-menu {
    position: absolute;
    z-index: 30;
    top: calc(100% + 7px);
    right: 0;
    padding: 6px;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-compact);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    transform-origin: top right;
    animation: menu-enter var(--sol-motion-enter) var(--sol-motion-ease) both;
  }

  .account-menu-panel {
    width: 202px;
  }

  .account-menu-panel button,
  .sort-menu button {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 10px;
    border-radius: 5px;
    background: transparent;
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-semibold);
    text-align: left;
    cursor: pointer;
  }

  .account-menu-panel button:hover,
  .account-menu-panel button:focus-visible,
  .sort-menu button:hover,
  .sort-menu button:focus-visible,
  .sort-menu button[aria-pressed="true"] {
    background: var(--sol-row-hover);
    color: var(--sol-text);
  }

  .dashboard-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    padding: 42px 0 28px;
  }

  .dashboard-heading h1 {
    margin: 0;
    font-family: var(--sol-font-brand);
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1.05;
  }

  .dashboard-heading div > span,
  .dashboard-heading > p {
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
  }

  .summary-label {
    margin: 0;
    color: var(--sol-accent);
    font-size: 10px;
    font-weight: var(--sol-weight-bold);
    letter-spacing: var(--sol-tracking-label);
    text-transform: uppercase;
  }

  .status-note {
    margin: 0 0 18px;
    padding: 10px 12px;
    border-left: 2px solid var(--sol-accent);
    color: var(--sol-muted);
    background: var(--sol-control-bg);
    font-size: var(--sol-type-label);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--sol-rule);
    border-bottom: 1px solid var(--sol-rule);
  }

  .metrics > div {
    display: grid;
    min-width: 0;
    gap: 5px;
    padding: 18px 20px;
    border-right: 1px solid var(--sol-rule);
  }

  .metrics > div:first-child {
    padding-left: 0;
  }

  .metrics > div:last-child {
    border-right: 0;
  }

  .metrics span {
    color: var(--sol-muted);
    font-size: 10px;
    font-weight: var(--sol-weight-semibold);
    text-transform: uppercase;
  }

  .metrics strong {
    overflow: hidden;
    font-size: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .streak-label {
    gap: 5px;
  }

  .streak-label :global(svg) {
    color: var(--sol-accent);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
    gap: 12px;
    padding: 28px 0 12px;
  }

  .summary-panel {
    min-height: 190px;
    padding: 20px;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-compact);
    background: var(--sol-surface);
  }

  .summary-panel h2 {
    max-width: 26ch;
    margin: 22px 0 0;
    font-family: var(--sol-font-brand);
    font-size: clamp(20px, 2.5vw, 29px);
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.18;
  }

  .summary-panel > p:last-child {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 18px 0 0;
    color: var(--sol-muted);
    font-size: var(--sol-type-label);
  }

  .summary-panel > p strong {
    color: var(--sol-accent);
  }

  .summary-panel > p span {
    width: 100%;
  }

  .rhythm-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .rhythm-chart {
    display: grid;
    height: 130px;
    grid-template-columns: repeat(14, minmax(6px, 1fr));
    align-items: end;
    gap: 8px;
    margin-top: 0;
    border-bottom: 1px solid var(--sol-rule);
  }

  .rhythm-column {
    display: flex;
    height: 100%;
    align-items: end;
    justify-content: center;
  }

  .rhythm-column i {
    display: block;
    width: 80%;
    height: max(var(--bar-min-height), calc(var(--bar-height) * 119px));
    border-radius: 2px 2px 0 0;
    background: var(--sol-accent);
    opacity: 0.8;
    transform-origin: bottom;
    animation: bar-enter var(--sol-motion-enter) var(--sol-motion-ease) both;
  }

  .rhythm-axis {
    display: grid;
    grid-template-columns: repeat(14, minmax(0, 1fr));
    gap: 8px;
    padding-top: 7px;
    color: var(--sol-muted);
    font-size: 9px;
    text-align: center;
  }

  .history-section {
    margin-top: 16px;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-compact);
    background: var(--sol-surface);
    overflow: hidden;
  }

  .history-header {
    display: flex;
    min-height: 70px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--sol-rule);
  }

  .history-section h2 {
    margin: 0;
    font-size: var(--sol-type-heading);
  }

  .history-controls {
    display: grid;
    grid-template-columns: minmax(0, 270px) 36px 36px;
    gap: 10px;
  }

  .period-switch {
    position: relative;
    display: grid;
    width: 270px;
    height: 36px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--sol-border);
    border-radius: 7px;
    background: var(--sol-control-bg);
    overflow: hidden;
  }

  .period-indicator {
    z-index: 0;
    grid-column: 1;
    grid-row: 1;
    border: 1px solid color-mix(in srgb, var(--sol-border) 75%, transparent);
    border-radius: 4px;
    background: var(--sol-surface);
    pointer-events: none;
    transition: transform 420ms var(--sol-motion-ease);
  }

  .period-indicator[data-selected="week"] { transform: translateX(calc(100% + 3px)); }
  .period-indicator[data-selected="month"] { transform: translateX(calc(200% + 6px)); }
  .period-indicator[data-selected="all"] { transform: translateX(calc(300% + 9px)); }

  .period-switch button {
    z-index: 1;
    grid-row: 1;
    min-width: 0;
    padding: 0 6px;
    border-radius: 4px;
    background: transparent;
    color: var(--sol-muted);
    font-size: 10px;
    font-weight: var(--sol-weight-semibold);
    cursor: pointer;
  }

  .period-switch button:nth-child(2) { grid-column: 1; }
  .period-switch button:nth-child(3) { grid-column: 2; }
  .period-switch button:nth-child(4) { grid-column: 3; }
  .period-switch button:nth-child(5) { grid-column: 4; }

  .period-switch button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--sol-row-active) 40%, transparent);
    color: var(--sol-text);
  }

  .period-switch button[aria-selected="true"] {
    color: var(--sol-text);
  }

  .period-switch button:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .sort-dropdown {
    height: 36px;
  }

  .sort-trigger,
  .history-share-trigger {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    padding: 0;
    border: 1px solid var(--sol-border);
    border-radius: 7px;
    background: var(--sol-control-bg);
    color: var(--sol-muted);
    cursor: pointer;
  }

  .sort-trigger:hover,
  .history-share-trigger:hover,
  .sort-dropdown[open] .sort-trigger {
    border-color: var(--sol-row-active-border);
    background: var(--sol-surface);
    color: var(--sol-text);
  }

  .sort-menu {
    width: 196px;
  }

  .sort-menu p {
    margin: 4px 8px 5px;
    color: var(--sol-muted);
    font-size: 10px;
    font-weight: var(--sol-weight-semibold);
    text-transform: uppercase;
  }

  .sort-menu .sort-direction-option {
    margin-top: 4px;
    border-top: 1px solid var(--sol-rule);
    border-radius: 0 0 5px 5px;
  }

  .listening-table-wrap {
    overflow-x: auto;
  }

  .listening-table {
    min-width: 760px;
  }

  .table-header,
  .table-row {
    display: grid;
    grid-template-columns:
      minmax(260px, 2.4fr)
      minmax(100px, 0.8fr)
      minmax(80px, 0.6fr)
      minmax(110px, 0.8fr)
      minmax(110px, 0.8fr);
    align-items: center;
  }

  .table-header {
    min-height: 34px;
    color: var(--sol-muted);
    background: var(--sol-control-bg);
    font-size: 9px;
    font-weight: var(--sol-weight-semibold);
    text-transform: uppercase;
  }

  .table-header span,
  .table-row > * {
    min-width: 0;
    padding: 9px 14px;
  }

  .table-row {
    min-height: 48px;
    border-top: 1px solid var(--sol-rule);
    font-size: var(--sol-type-label);
    animation: row-enter var(--sol-motion-enter) var(--sol-motion-ease)
      calc(var(--row-index, 0) * var(--sol-motion-stagger)) both;
  }

  .table-body {
    height: 288px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .table-row-placeholder {
    pointer-events: none;
  }

  .table-row-placeholder:hover {
    background: transparent;
  }

  .table-row:hover {
    background: var(--sol-row-hover);
  }

  .affirmation-cell {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .table-row strong {
    min-width: 0;
    flex: 1;
    display: block;
    overflow: hidden;
    font-weight: var(--sol-weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-row span {
    color: var(--sol-muted);
  }

  .row-share-button {
    display: grid;
    width: 30px;
    height: 30px;
    flex: none;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--sol-radius-compact);
    color: var(--sol-muted);
    background: transparent;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .table-row:hover .row-share-button,
  .row-share-button:focus-visible {
    opacity: 1;
  }

  .row-share-button:hover,
  .row-share-button:focus-visible {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .empty-state,
  .center-state {
    display: grid;
    place-items: center;
    text-align: center;
  }

  .empty-state {
    min-height: 260px;
    padding: 28px;
  }

  .empty-state strong,
  .center-state strong {
    margin-top: 10px;
    font-size: var(--sol-type-heading);
  }

  .empty-state p,
  .center-state p {
    max-width: 45ch;
    margin: 7px 0 18px;
    color: var(--sol-muted);
    font-size: var(--sol-type-label);
  }

  .center-state {
    min-height: 100vh;
    padding: 32px;
  }

  .center-state :global(.loading-spinner) {
    color: var(--sol-accent);
  }

  .state-mark {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    filter: var(--sol-brand-shadow);
  }

  .state-icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    color: var(--sol-accent);
  }

  .primary-button,
  .secondary-button {
    min-height: 36px;
    padding: 0 16px;
    border-radius: var(--sol-radius-compact);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    cursor: pointer;
  }

  .primary-button {
    color: var(--sol-button-fg);
    background: var(--sol-accent);
  }

  .secondary-button {
    border: 1px solid var(--sol-border);
    background: var(--sol-control-bg);
  }

  .primary-button:hover,
  .secondary-button:hover {
    filter: brightness(1.06);
  }

  .community-footer {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-top: 24px;
    border-top: 1px solid var(--sol-rule);
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
  }

  .community-identity,
  .community-footer button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .community-identity :global(svg) {
    color: var(--sol-accent);
  }

  .community-footer button {
    padding: 7px 0;
    color: var(--sol-text);
    background: transparent;
    font-size: inherit;
    font-weight: var(--sol-weight-semibold);
    cursor: pointer;
  }

  .community-footer button:hover,
  .community-footer button:focus-visible {
    color: var(--sol-accent);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes menu-enter {
    from { opacity: 0; transform: translateY(-6px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes bar-enter {
    from { opacity: 0; transform: scaleY(0); }
  }

  @keyframes row-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 760px) {
    .dashboard-shell {
      width: min(100% - 28px, 1160px);
    }

    .dashboard-heading {
      align-items: start;
      flex-direction: column;
      padding-top: 30px;
    }

    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metrics > div {
      border-bottom: 1px solid var(--sol-rule);
    }

    .metrics > div:nth-child(2) {
      border-right: 0;
    }

    .metrics > div:nth-last-child(-n + 2) {
      border-bottom: 0;
    }

    .metrics > div:first-child {
      padding-left: 20px;
    }

    .summary-grid {
      grid-template-columns: 1fr;
    }

    .history-header {
      align-items: stretch;
      flex-direction: column;
      gap: 12px;
    }

    .history-controls {
      align-self: flex-end;
    }
  }

  @media (max-width: 440px) {
    .dashboard-shell {
      width: min(100% - 20px, 1160px);
      padding-top: 8px;
    }

    .plan-badge {
      display: none;
    }

    .history-controls {
      width: 100%;
      grid-template-columns: minmax(0, 1fr) 36px 36px;
    }

    .period-switch {
      width: 100%;
    }

    .metrics strong {
      font-size: 17px;
    }

    .rhythm-chart {
      gap: 4px;
    }

    .rhythm-axis {
      gap: 4px;
    }
  }

  @media (hover: none) {
    .row-share-button {
      opacity: 0.72;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-button.spinning :global(svg),
    .rhythm-column i,
    .table-row,
    .account-menu-panel,
    .sort-menu {
      animation: none;
    }

    .period-indicator { transition: none; }
  }
</style>
