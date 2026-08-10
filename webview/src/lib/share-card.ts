export type ShareCardTheme = 'dark' | 'light';
export type ShareCardFormat = 'compact' | 'story';

export type ShareCardAffirmation = {
	id: string;
	text: string;
	completedListens: number;
	listenedMs: number;
};

export type ShareCardModel = {
	affirmation: ShareCardAffirmation;
	displayName: string;
	streakDays: number | null;
	includeName: boolean;
	theme: ShareCardTheme;
	format: ShareCardFormat;
};

export type ProgressSharePoint = {
	label: string;
	listenedMs: number;
};

export type ProgressShareSummary = {
	period: 'today' | 'week' | 'month' | 'all';
	periodLabel: string;
	listenedMs: number;
	completedListens: number;
	affirmationCount: number;
	chartKind: 'timeline' | 'affirmations';
	points: ProgressSharePoint[];
};

export type ProgressShareCardModel = ProgressShareSummary & {
	displayName: string;
	streakDays: number | null;
	includeName: boolean;
	theme: ShareCardTheme;
	format: ShareCardFormat;
};

type CardPalette = {
	background: string;
	text: string;
	muted: string;
	rule: string;
	brand: string;
	accent: string;
};

const CARD_PALETTES: Record<ShareCardTheme, CardPalette> = {
	dark: {
		background: '#1b1b1b',
		text: '#fafafa',
		muted: '#c6c3c1',
		rule: '#696765',
		brand: '#71372f',
		accent: '#ed7955'
	},
	light: {
		background: '#fafafa',
		text: '#181818',
		muted: '#55514e',
		rule: '#b9b5b2',
		brand: '#8f3f2c',
		accent: '#c85f3f'
	}
};

export const SHARE_CARD_WIDTH = 1080;
export const COMPACT_SHARE_CARD_HEIGHT = 820;
export const STORY_SHARE_CARD_HEIGHT = 1920;

export function formatCompactCount(value: number): string {
	const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
	if (safeValue < 1000) return new Intl.NumberFormat('en-US').format(safeValue);

	return new Intl.NumberFormat('en-US', {
		notation: 'compact',
		compactDisplay: 'short',
		maximumFractionDigits: 1
	})
		.format(safeValue)
		.replace('K', 'k');
}

export function formatShareCardDuration(milliseconds: number): string {
	const totalMinutes = Math.round(Math.max(0, milliseconds) / 60_000);
	if (totalMinutes < 1) return milliseconds > 0 ? '<1m' : '0m';
	if (totalMinutes < 60) return `${totalMinutes}m`;

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function wrapCanvasText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const words = text.trim().split(/\s+/);
	const lines: string[] = [];
	let line = '';

	for (let word of words) {
		if (context.measureText(word).width > maxWidth) {
			if (line) {
				lines.push(line);
				line = '';
			}

			let fragment = '';
			for (const character of word) {
				const candidate = `${fragment}${character}`;
				if (context.measureText(candidate).width <= maxWidth || !fragment) {
					fragment = candidate;
				} else {
					lines.push(fragment);
					fragment = character;
				}
			}
			word = fragment;
		}

		const candidate = line ? `${line} ${word}` : word;
		if (context.measureText(candidate).width <= maxWidth || !line) {
			line = candidate;
		} else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function fitCanvasAffirmation(
	context: CanvasRenderingContext2D,
	text: string
): { fontSize: number; lineHeight: number; lines: string[] } {
	for (let fontSize = 108; fontSize >= 42; fontSize -= 2) {
		context.font = `400 ${fontSize}px "DM Serif Display", Georgia, serif`;
		const lineHeight = fontSize * 1.06;
		const lines = wrapCanvasText(context, text, 900);
		const maximumLines = Math.floor(284 / lineHeight);
		if (lines.length <= maximumLines) return { fontSize, lineHeight, lines };
	}

	context.font = '400 42px "DM Serif Display", Georgia, serif';
	return {
		fontSize: 42,
		lineHeight: 44.52,
		lines: wrapCanvasText(context, text, 900)
	};
}

function drawGlowMark(context: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
	const layers = [
		{ radius: 25, color: '#ee5d78' },
		{ radius: 21, color: '#ff8066' },
		{ radius: 16, color: '#ffc66c' },
		{ radius: 10, color: '#fff0b2' },
		{ radius: 5, color: '#fffdf0' }
	];

	context.save();
	context.translate(x, y);
	context.rotate(-0.08);
	context.shadowColor = 'rgb(255 106 91 / 38%)';
	context.shadowBlur = 16 * scale;
	for (const layer of layers) {
		context.beginPath();
		context.ellipse(0, 0, layer.radius * 0.92 * scale, layer.radius * scale, 0, 0, Math.PI * 2);
		context.fillStyle = layer.color;
		context.fill();
	}
	context.restore();
}

export async function renderShareCardCanvas(
	canvas: HTMLCanvasElement,
	model: ShareCardModel,
	isCurrent: () => boolean = () => true
): Promise<void> {
	await document.fonts.ready;
	await Promise.all([
		document.fonts.load('400 108px "DM Serif Display"'),
		document.fonts.load('700 48px "DM Sans"'),
		document.fonts.load('600 26px "DM Sans"')
	]);
	if (!isCurrent()) return;

	canvas.width = SHARE_CARD_WIDTH;
	canvas.height = model.format === 'story' ? STORY_SHARE_CARD_HEIGHT : COMPACT_SHARE_CARD_HEIGHT;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas is unavailable');
	const palette = CARD_PALETTES[model.theme];
	const contentOffsetY =
		model.format === 'story' ? (canvas.height - COMPACT_SHARE_CARD_HEIGHT) / 2 : 0;
	const contentY = (position: number) => position + contentOffsetY;

	context.fillStyle = palette.background;
	context.fillRect(0, 0, canvas.width, canvas.height);

	drawGlowMark(context, SHARE_CARD_WIDTH / 2, contentY(52), 0.58);

	const affirmationLayout = fitCanvasAffirmation(context, model.affirmation.text);
	context.fillStyle = palette.text;
	context.font = `400 ${affirmationLayout.fontSize}px "DM Serif Display", Georgia, serif`;
	context.textAlign = 'center';
	context.textBaseline = 'top';
	const affirmationBlockHeight = affirmationLayout.lines.length * affirmationLayout.lineHeight;
	const affirmationStartY = 165 + (290 - affirmationBlockHeight) / 2;
	affirmationLayout.lines.forEach((line, index) => {
		context.fillText(
			line,
			SHARE_CARD_WIDTH / 2,
			contentY(affirmationStartY + index * affirmationLayout.lineHeight)
		);
	});

	const metrics = [
		{ label: 'Listened', value: formatShareCardDuration(model.affirmation.listenedMs) },
		{ label: 'Repeated', value: `${formatCompactCount(model.affirmation.completedListens)}×` },
		{
			label: 'Streak',
			value: model.streakDays === null ? '—' : `${formatCompactCount(model.streakDays)}d`
		}
	];
	const metricCenters = [276, 540, 804];
	context.textAlign = 'center';
	context.textBaseline = 'top';
	for (const [index, metric] of metrics.entries()) {
		context.fillStyle = palette.muted;
		context.font = '500 26px "DM Sans", sans-serif';
		context.fillText(metric.label, metricCenters[index], contentY(570));
		context.fillStyle = palette.text;
		context.font = '500 48px "DM Sans", sans-serif';
		context.fillText(metric.value, metricCenters[index], contentY(612));
	}

	context.strokeStyle = palette.rule;
	context.lineWidth = 2;
	for (const x of [408, 672]) {
		context.beginPath();
		context.moveTo(x, contentY(572));
		context.lineTo(x, contentY(675));
		context.stroke();
	}

	context.fillStyle = palette.brand;
	context.font = '600 25px "DM Sans", sans-serif';
	const footer = model.includeName ? `${model.displayName}  ·  justglow.dev` : 'justglow.dev';
	context.fillText(footer, SHARE_CARD_WIDTH / 2, contentY(752));
}

export async function createShareCardBlob(model: ShareCardModel): Promise<Blob> {
	const canvas = document.createElement('canvas');
	await renderShareCardCanvas(canvas, model);
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Image export failed'))),
			'image/png'
		);
	});
}

export function shareCardFilename(text: string, format: ShareCardFormat): string {
	const fullSlug =
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'affirmation';
	const slug = fullSlug.length <= 42 ? fullSlug : fullSlug.slice(0, 42).replace(/-[^-]*$/, '');
	const formatSuffix = format === 'story' ? '-story' : '';
	return `glow-${slug}-progress${formatSuffix}.png`;
}

function compactChartLabel(value: string, maximum = 20): string {
	const normalized = value.trim();
	if (normalized.length <= maximum) return normalized;
	return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function drawTimelineChart(
	context: CanvasRenderingContext2D,
	model: ProgressShareCardModel,
	palette: CardPalette,
	contentY: (position: number) => number
): void {
	const points = model.points;
	const chartLeft = 114;
	const chartRight = 966;
	const chartTop = contentY(316);
	const chartBottom = contentY(516);
	const maximum = Math.max(...points.map((point) => point.listenedMs), 0);
	const slotWidth = (chartRight - chartLeft) / Math.max(points.length, 1);
	const barWidth = Math.min(56, Math.max(12, slotWidth * 0.54));
	let highlightedIndex = -1;
	for (let index = points.length - 1; index >= 0; index -= 1) {
		if (points[index]!.listenedMs > 0) {
			highlightedIndex = index;
			break;
		}
	}

	context.strokeStyle = palette.rule;
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(chartLeft, chartBottom);
	context.lineTo(chartRight, chartBottom);
	context.stroke();

	for (const [index, point] of points.entries()) {
		const ratio = maximum === 0 ? 0 : point.listenedMs / maximum;
		const height = point.listenedMs > 0 ? Math.max(7, ratio * (chartBottom - chartTop)) : 4;
		const x = chartLeft + slotWidth * index + (slotWidth - barWidth) / 2;
		const y = chartBottom - height;
		context.fillStyle = index === highlightedIndex ? palette.accent : palette.rule;
		context.beginPath();
		context.roundRect(x, y, barWidth, height, Math.min(8, barWidth / 3));
		context.fill();

		context.fillStyle = palette.muted;
		context.font = '500 19px "DM Sans", sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'top';
		context.fillText(compactChartLabel(point.label, 8), x + barWidth / 2, contentY(532));
	}
}

function drawAffirmationChart(
	context: CanvasRenderingContext2D,
	model: ProgressShareCardModel,
	palette: CardPalette,
	contentY: (position: number) => number
): void {
	const points = model.points.slice(0, 8);
	const maximum = Math.max(...points.map((point) => point.listenedMs), 0);
	const labelX = 114;
	const barLeft = 350;
	const barRight = 966;
	const rowHeight = 29;
	const firstRowY = contentY(316);

	for (const [index, point] of points.entries()) {
		const y = firstRowY + index * rowHeight;
		const ratio = maximum === 0 ? 0 : point.listenedMs / maximum;
		context.fillStyle = palette.muted;
		context.font = '500 19px "DM Sans", sans-serif';
		context.textAlign = 'left';
		context.textBaseline = 'middle';
		context.fillText(compactChartLabel(point.label, 23), labelX, y + 7);

		context.fillStyle = palette.rule;
		context.beginPath();
		context.roundRect(barLeft, y + 2, barRight - barLeft, 10, 5);
		context.fill();
		if (point.listenedMs > 0) {
			context.fillStyle = index === 0 ? palette.accent : palette.muted;
			context.beginPath();
			context.roundRect(barLeft, y + 2, Math.max(8, (barRight - barLeft) * ratio), 10, 5);
			context.fill();
		}
	}
}

export async function renderProgressShareCardCanvas(
	canvas: HTMLCanvasElement,
	model: ProgressShareCardModel,
	isCurrent: () => boolean = () => true
): Promise<void> {
	await document.fonts.ready;
	await Promise.all([
		document.fonts.load('500 94px "DM Sans"'),
		document.fonts.load('600 25px "DM Sans"'),
		document.fonts.load('500 19px "DM Sans"')
	]);
	if (!isCurrent()) return;

	canvas.width = SHARE_CARD_WIDTH;
	canvas.height = model.format === 'story' ? STORY_SHARE_CARD_HEIGHT : COMPACT_SHARE_CARD_HEIGHT;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas is unavailable');
	const palette = CARD_PALETTES[model.theme];
	const contentOffsetY =
		model.format === 'story' ? (canvas.height - COMPACT_SHARE_CARD_HEIGHT) / 2 : 0;
	const contentY = (position: number) => position + contentOffsetY;

	context.fillStyle = palette.background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	drawGlowMark(context, SHARE_CARD_WIDTH / 2, contentY(52), 0.58);

	context.textAlign = 'center';
	context.textBaseline = 'top';
	context.fillStyle = palette.muted;
	context.font = '600 22px "DM Sans", sans-serif';
	context.fillText(model.periodLabel.toUpperCase(), SHARE_CARD_WIDTH / 2, contentY(105));

	context.fillStyle = palette.text;
	context.font = '500 94px "DM Sans", sans-serif';
	context.fillText(formatShareCardDuration(model.listenedMs), SHARE_CARD_WIDTH / 2, contentY(142));
	context.fillStyle = palette.muted;
	context.font = '500 25px "DM Sans", sans-serif';
	context.fillText('listening time', SHARE_CARD_WIDTH / 2, contentY(251));

	if (model.chartKind === 'timeline') {
		drawTimelineChart(context, model, palette, contentY);
	} else {
		drawAffirmationChart(context, model, palette, contentY);
	}

	const metrics = [
		{ label: 'Repeated', value: `${formatCompactCount(model.completedListens)}×` },
		{ label: 'Affirmations', value: formatCompactCount(model.affirmationCount) },
		{
			label: 'Streak',
			value: model.streakDays === null ? '—' : `${formatCompactCount(model.streakDays)}d`
		}
	];
	const metricCenters = [276, 540, 804];
	context.textAlign = 'center';
	context.textBaseline = 'top';
	for (const [index, metric] of metrics.entries()) {
		context.fillStyle = palette.muted;
		context.font = '500 26px "DM Sans", sans-serif';
		context.fillText(metric.label, metricCenters[index], contentY(592));
		context.fillStyle = palette.text;
		context.font = '500 48px "DM Sans", sans-serif';
		context.fillText(metric.value, metricCenters[index], contentY(632));
	}

	context.strokeStyle = palette.rule;
	context.lineWidth = 2;
	for (const x of [408, 672]) {
		context.beginPath();
		context.moveTo(x, contentY(594));
		context.lineTo(x, contentY(694));
		context.stroke();
	}

	context.fillStyle = palette.brand;
	context.font = '600 25px "DM Sans", sans-serif';
	const footer = model.includeName ? `${model.displayName}  ·  justglow.dev` : 'justglow.dev';
	context.fillText(footer, SHARE_CARD_WIDTH / 2, contentY(752));
}

export async function createProgressShareCardBlob(model: ProgressShareCardModel): Promise<Blob> {
	const canvas = document.createElement('canvas');
	await renderProgressShareCardCanvas(canvas, model);
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Image export failed'))),
			'image/png'
		);
	});
}

export function progressShareCardFilename(
	period: ProgressShareCardModel['period'],
	format: ShareCardFormat
): string {
	const formatSuffix = format === 'story' ? '-story' : '';
	return `glow-${period}-progress${formatSuffix}.png`;
}
