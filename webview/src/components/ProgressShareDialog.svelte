<script lang="ts">
	import { Check, CircleNotch, Copy, DownloadSimple, ShareNetwork, X } from 'phosphor-svelte';
	import {
		COMPACT_SHARE_CARD_HEIGHT,
		createProgressShareCardBlob,
		formatCompactCount,
		formatShareCardDuration,
		progressShareCardFilename,
		renderProgressShareCardCanvas,
		SHARE_CARD_WIDTH,
		STORY_SHARE_CARD_HEIGHT
	} from '$lib/share-card';
	import type {
		ProgressShareCardModel,
		ProgressShareSummary,
		ShareCardFormat,
		ShareCardTheme
	} from '$lib/share-card';

	type SharePeriod = ProgressShareSummary['period'];
	type Props = {
		open: boolean;
		summary: ProgressShareSummary;
		displayName: string;
		streakDays: number | null;
		historyPeriodsAvailable: boolean;
		onClose: () => void;
		onPeriodChange: (period: SharePeriod) => void;
	};

	const PERIODS = [
		{ id: 'today', label: 'Today' },
		{ id: 'week', label: 'Week' },
		{ id: 'month', label: 'Month' },
		{ id: 'all', label: 'All time' }
	] as const;
	const CARD_THEMES = [
		{ id: 'dark', label: 'Black' },
		{ id: 'light', label: 'White' }
	] as const satisfies ReadonlyArray<{ id: ShareCardTheme; label: string }>;
	const CARD_FORMATS = [
		{ id: 'compact', label: 'Compact' },
		{ id: 'story', label: 'Story 9:16' }
	] as const satisfies ReadonlyArray<{ id: ShareCardFormat; label: string }>;

	let {
		open,
		summary,
		displayName,
		streakDays,
		historyPeriodsAvailable,
		onClose,
		onPeriodChange
	}: Props = $props();
	let dialogElement = $state<HTMLDialogElement>();
	let closeButton = $state<HTMLButtonElement>();
	let previewCanvas = $state<HTMLCanvasElement>();
	let includeName = $state(false);
	let cardTheme = $state<ShareCardTheme>('dark');
	let cardFormat = $state<ShareCardFormat>('compact');
	let previewRenderVersion = 0;
	let exportState = $state<'idle' | 'working' | 'shared' | 'copied' | 'downloaded' | 'error'>(
		'idle'
	);
	const model = $derived.by((): ProgressShareCardModel => ({
		...summary,
		displayName,
		streakDays,
		includeName,
		theme: cardTheme,
		format: cardFormat
	}));
	const statusMessage = $derived(
		exportState === 'shared'
			? 'Share sheet opened'
			: exportState === 'copied'
				? 'Image copied'
				: exportState === 'downloaded'
					? 'Image downloaded'
					: exportState === 'error'
						? 'Unable to create the image'
						: ''
	);

	$effect(() => {
		if (!dialogElement) return;
		if (open && !dialogElement.open) {
			exportState = 'idle';
			dialogElement.showModal();
			requestAnimationFrame(() => closeButton?.focus());
		} else if (!open && dialogElement.open) {
			dialogElement.close();
		}
	});

	$effect(() => {
		const canvas = previewCanvas;
		const currentModel = model;
		if (!canvas) return;
		const renderVersion = ++previewRenderVersion;
		void renderProgressShareCardCanvas(
			canvas,
			currentModel,
			() => renderVersion === previewRenderVersion
		);
	});

	function requestClose(): void {
		if (dialogElement?.open) dialogElement.close();
		onClose();
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === dialogElement) requestClose();
	}

	function handleCancel(event: Event): void {
		event.preventDefault();
		requestClose();
	}

	function selectTheme(theme: ShareCardTheme): void {
		cardTheme = theme;
		exportState = 'idle';
	}

	function selectFormat(format: ShareCardFormat): void {
		cardFormat = format;
		exportState = 'idle';
	}

	function filename(): string {
		return progressShareCardFilename(summary.period, cardFormat);
	}

	function downloadBlob(blob: Blob): void {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename();
		anchor.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	async function createBlob(): Promise<Blob> {
		return createProgressShareCardBlob(model);
	}

	async function shareCard(): Promise<void> {
		if (exportState === 'working') return;
		exportState = 'working';
		try {
			const blob = await createBlob();
			const file = new File([blob], filename(), { type: 'image/png' });
			const shareData = {
				title: 'My Glow progress',
				text: `I listened for ${formatShareCardDuration(summary.listenedMs)} and completed ${formatCompactCount(summary.completedListens)} affirmations with Glow.`,
				files: [file]
			};
			if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
				await navigator.share(shareData);
				exportState = 'shared';
				return;
			}
			downloadBlob(blob);
			exportState = 'downloaded';
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				exportState = 'idle';
				return;
			}
			exportState = 'error';
		}
	}

	async function copyCard(): Promise<void> {
		if (exportState === 'working') return;
		exportState = 'working';
		try {
			const blob = await createBlob();
			if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
				downloadBlob(blob);
				exportState = 'downloaded';
				return;
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			exportState = 'copied';
		} catch {
			exportState = 'error';
		}
	}

	async function downloadCard(): Promise<void> {
		if (exportState === 'working') return;
		exportState = 'working';
		try {
			downloadBlob(await createBlob());
			exportState = 'downloaded';
		} catch {
			exportState = 'error';
		}
	}
</script>

<dialog
	bind:this={dialogElement}
	class="share-dialog"
	aria-labelledby="progress-share-title"
	onclick={handleBackdropClick}
	oncancel={handleCancel}
>
	<div class="share-dialog-shell">
		<header class="share-dialog-header">
			<div>
				<p>Share progress</p>
				<h2 id="progress-share-title">Your practice, made visible.</h2>
			</div>
			<button
				bind:this={closeButton}
				class="icon-button close-button"
				type="button"
				aria-label="Close progress share preview"
				title="Close"
				onclick={requestClose}
			>
				<X size={18} weight="bold" aria-hidden="true" />
			</button>
		</header>

		<div class="share-dialog-body">
			<div class="share-card-wrap">
				<canvas
					bind:this={previewCanvas}
					class="share-card"
					data-theme={cardTheme}
					data-format={cardFormat}
					width={SHARE_CARD_WIDTH}
					height={cardFormat === 'story' ? STORY_SHARE_CARD_HEIGHT : COMPACT_SHARE_CARD_HEIGHT}
					aria-label={`Glow progress share card for ${summary.periodLabel}`}
				></canvas>
			</div>

			<div class="share-options">
				<div class="share-period" role="tablist" aria-label="Progress share period">
					{#each PERIODS as option (option.id)}
						<button
							type="button"
							role="tab"
							aria-selected={summary.period === option.id}
							disabled={option.id !== 'all' && !historyPeriodsAvailable}
							onclick={() => onPeriodChange(option.id)}
						>
							{option.label}
						</button>
					{/each}
				</div>

				<div class="option-row">
					<span>Format</span>
					<div class="segmented" role="radiogroup" aria-label="Card format">
						{#each CARD_FORMATS as format (format.id)}
							<button
								type="button"
								role="radio"
								aria-checked={cardFormat === format.id}
								onclick={() => selectFormat(format.id)}
							>
								{format.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="option-row">
					<span>Card theme</span>
					<div class="theme-swatches" role="radiogroup" aria-label="Card theme">
						{#each CARD_THEMES as theme (theme.id)}
							<button
								type="button"
								role="radio"
								aria-checked={cardTheme === theme.id}
								aria-label={`${theme.label} card theme`}
								onclick={() => selectTheme(theme.id)}
							>
								<span class:dark={theme.id === 'dark'} class:light={theme.id === 'light'}></span>
								{#if cardTheme === theme.id}
									<Check size={13} weight="bold" aria-hidden="true" />
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<label class="name-option">
					<input type="checkbox" bind:checked={includeName} />
					<span>Include my name</span>
				</label>

				<div class="share-actions">
					<button
						class="share-primary"
						type="button"
						disabled={exportState === 'working'}
						onclick={shareCard}
					>
						{#if exportState === 'working'}
							<span class="spinner"><CircleNotch size={18} weight="bold" aria-hidden="true" /></span
							>
						{:else if exportState === 'shared'}
							<Check size={18} weight="bold" aria-hidden="true" />
						{:else}
							<ShareNetwork size={18} weight="bold" aria-hidden="true" />
						{/if}
						Share image
					</button>
					<button
						class="icon-button"
						type="button"
						disabled={exportState === 'working'}
						aria-label="Copy progress image"
						title="Copy image"
						onclick={copyCard}
					>
						<Copy size={18} weight="bold" aria-hidden="true" />
					</button>
					<button
						class="icon-button"
						type="button"
						disabled={exportState === 'working'}
						aria-label="Download progress image"
						title="Download image"
						onclick={downloadCard}
					>
						<DownloadSimple size={18} weight="bold" aria-hidden="true" />
					</button>
				</div>
				<p class="share-status" role="status">{statusMessage}</p>
			</div>
		</div>
	</div>
</dialog>

<style>
	.share-dialog {
		width: min(920px, calc(100% - 32px));
		max-width: none;
		max-height: calc(100svh - 32px);
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--dashboard-border);
		border-radius: 8px;
		background: var(--dashboard-bg);
		box-shadow: 0 28px 80px rgb(0 0 0 / 36%);
		color: var(--dashboard-text);
	}

	.share-dialog::backdrop {
		background: rgb(10 8 7 / 70%);
		backdrop-filter: blur(4px);
	}

	.share-dialog-shell {
		display: flex;
		max-height: calc(100svh - 34px);
		flex-direction: column;
	}

	.share-dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		padding: 20px 22px;
		border-bottom: 1px solid var(--dashboard-rule);
	}

	.share-dialog-header p {
		margin: 0 0 5px;
		color: var(--dashboard-accent);
		font-size: 0.64rem;
		font-weight: 750;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.share-dialog-header h2 {
		margin: 0;
		font-family: var(--glow-font-display);
		font-size: 1.45rem;
		font-weight: 560;
		line-height: 1.08;
	}

	.share-dialog-body {
		display: grid;
		min-height: 0;
		grid-template-columns: minmax(320px, 1fr) minmax(260px, 0.72fr);
		gap: 26px;
		padding: 24px;
		overflow: auto;
	}

	.share-card-wrap {
		display: grid;
		min-width: 0;
		place-items: center;
	}

	.share-card {
		display: block;
		width: min(100%, 390px);
		height: auto;
		aspect-ratio: 54 / 41;
		border: 0;
		border-radius: 6px;
		background: #1b1b1b;
	}

	.share-card[data-format='story'] {
		aspect-ratio: 9 / 16;
	}

	.share-card[data-theme='light'] {
		background: #fafafa;
	}

	.share-options {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-self: center;
	}

	.share-period,
	.segmented {
		display: grid;
		gap: 3px;
		padding: 3px;
		border: 1px solid var(--dashboard-border);
		border-radius: 7px;
		background: var(--dashboard-control-bg);
	}

	.share-period {
		height: 40px;
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.segmented {
		width: 150px;
		height: 34px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.share-period button,
	.segmented button {
		min-width: 0;
		padding: 0 7px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--dashboard-muted);
		font-size: 0.64rem;
		font-weight: 650;
	}

	.share-period button[aria-selected='true'],
	.segmented button[aria-checked='true'] {
		border: 1px solid var(--dashboard-border);
		background: var(--dashboard-panel);
		color: var(--dashboard-text);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--dashboard-text) 10%, transparent);
	}

	.share-period button:disabled {
		cursor: default;
		opacity: 0.42;
	}

	.option-row {
		display: flex;
		min-height: 42px;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-top: 12px;
		color: var(--dashboard-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.theme-swatches {
		display: flex;
		gap: 7px;
	}

	.theme-swatches button {
		position: relative;
		display: grid;
		width: 36px;
		height: 32px;
		place-items: center;
		padding: 0;
		border: 1px solid var(--dashboard-border);
		border-radius: 6px;
		background: var(--dashboard-control-bg);
		color: var(--dashboard-text);
	}

	.theme-swatches button[aria-checked='true'] {
		border-color: var(--dashboard-accent);
	}

	.theme-swatches button > span {
		width: 17px;
		height: 17px;
		border: 1px solid #5a514b;
		border-radius: 50%;
	}

	.theme-swatches button > span.dark {
		background: #030303;
	}
	.theme-swatches button > span.light {
		border-color: #d4d4d4;
		background: #fff;
	}
	.theme-swatches button :global(svg) {
		position: absolute;
		right: -4px;
		bottom: -4px;
		padding: 2px;
		border-radius: 50%;
		background: var(--dashboard-accent);
		color: var(--dashboard-button-fg);
	}

	.name-option {
		display: flex;
		min-height: 42px;
		align-items: center;
		gap: 10px;
		margin-top: 3px;
		color: var(--dashboard-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.name-option input {
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--dashboard-accent);
	}

	.share-actions {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 42px 42px;
		gap: 8px;
		margin-top: 12px;
	}

	.share-primary,
	.icon-button {
		display: inline-flex;
		height: 42px;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--dashboard-border);
		border-radius: 7px;
		transition:
			background-color var(--glow-motion-feedback) var(--glow-motion-ease),
			border-color var(--glow-motion-feedback) var(--glow-motion-ease),
			color var(--glow-motion-feedback) var(--glow-motion-ease),
			transform var(--glow-motion-press) var(--glow-motion-ease);
	}

	.share-primary {
		gap: 8px;
		padding-inline: 15px;
		border-color: var(--dashboard-accent);
		background: var(--dashboard-accent);
		color: var(--dashboard-button-fg);
		font-size: 0.75rem;
		font-weight: 750;
	}

	.icon-button {
		width: 42px;
		background: var(--dashboard-control-bg);
		color: var(--dashboard-muted);
	}

	.close-button {
		flex: none;
	}
	.share-primary:hover:not(:disabled) {
		background: var(--dashboard-accent-hover);
	}
	.icon-button:hover:not(:disabled) {
		background: var(--dashboard-panel);
		color: var(--dashboard-text);
	}
	.share-primary:active:not(:disabled),
	.icon-button:active:not(:disabled) {
		transform: scale(var(--glow-press-scale));
	}
	.share-primary:disabled,
	.icon-button:disabled {
		cursor: default;
		opacity: 0.52;
	}

	.share-status {
		min-height: 17px;
		margin: 8px 0 0;
		color: var(--dashboard-muted);
		font-size: 0.68rem;
		text-align: center;
	}

	.spinner {
		display: inline-flex;
		animation: share-spinner 700ms linear infinite;
	}

	@keyframes share-spinner {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 720px) {
		.share-dialog {
			width: min(100% - 16px, 480px);
			max-height: calc(100svh - 12px);
		}
		.share-dialog-shell {
			max-height: calc(100svh - 14px);
		}
		.share-dialog-header {
			padding: 16px;
		}
		.share-dialog-header h2 {
			font-size: 1.2rem;
		}
		.share-dialog-body {
			display: block;
			padding: 16px;
		}
		.share-card {
			width: min(100%, 340px);
		}
		.share-options {
			width: min(100%, 340px);
			margin: 15px auto 0;
		}
	}

	@media (max-width: 360px) {
		.share-card,
		.share-options {
			width: 296px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
