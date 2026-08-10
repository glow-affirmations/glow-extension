<script lang="ts">
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import ArrowClockwiseIcon from "phosphor-svelte/lib/ArrowClockwiseIcon";
  import ArrowSquareOutIcon from "phosphor-svelte/lib/ArrowSquareOutIcon";
  import ChartBarIcon from "phosphor-svelte/lib/ChartBarIcon";
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
  import CaretLeftIcon from "phosphor-svelte/lib/CaretLeftIcon";
  import CreditCardIcon from "phosphor-svelte/lib/CreditCardIcon";
  import DotsThreeVerticalIcon from "phosphor-svelte/lib/DotsThreeVerticalIcon";
  import GithubLogoIcon from "phosphor-svelte/lib/GithubLogoIcon";
  import HeartIcon from "phosphor-svelte/lib/HeartIcon";
  import HeadphonesIcon from "phosphor-svelte/lib/HeadphonesIcon";
  import InfoIcon from "phosphor-svelte/lib/InfoIcon";
  import FireIcon from "phosphor-svelte/lib/FireIcon";
  import MoonStarsIcon from "phosphor-svelte/lib/MoonStarsIcon";
  import MonitorIcon from "phosphor-svelte/lib/MonitorIcon";
  import PlayIcon from "phosphor-svelte/lib/PlayIcon";
  import PlaylistIcon from "phosphor-svelte/lib/PlaylistIcon";
  import PlusIcon from "phosphor-svelte/lib/PlusIcon";
  import RepeatIcon from "phosphor-svelte/lib/RepeatIcon";
  import SkipBackIcon from "phosphor-svelte/lib/SkipBackIcon";
  import SkipForwardIcon from "phosphor-svelte/lib/SkipForwardIcon";
  import SparkleIcon from "phosphor-svelte/lib/SparkleIcon";
  import SpeakerHighIcon from "phosphor-svelte/lib/SpeakerHighIcon";
  import SpeakerLowIcon from "phosphor-svelte/lib/SpeakerLowIcon";
  import SpeakerXIcon from "phosphor-svelte/lib/SpeakerXIcon";
  import StopIcon from "phosphor-svelte/lib/StopIcon";
  import SunIcon from "phosphor-svelte/lib/SunIcon";
  import TrashSimpleIcon from "phosphor-svelte/lib/TrashSimpleIcon";
  import UserIcon from "phosphor-svelte/lib/UserIcon";
  import UsersThreeIcon from "phosphor-svelte/lib/UsersThreeIcon";
  import WaveformIcon from "phosphor-svelte/lib/WaveformIcon";
  import WarningIcon from "phosphor-svelte/lib/WarningIcon";
  import XCircleIcon from "phosphor-svelte/lib/XCircleIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";

  type IconName =
    | "heart"
    | "headphones"
    | "library"
    | "sparkles"
    | "trash"
    | "previous"
    | "next"
    | "play"
    | "stop"
    | "loop"
    | "arrow"
    | "external"
    | "billing"
    | "dashboard"
    | "fire"
    | "waveform"
    | "sun"
    | "moon"
    | "ide"
    | "user"
    | "community"
    | "more"
    | "github"
    | "plus"
    | "close"
    | "check"
    | "back"
    | "regenerate"
    | "info"
    | "success"
    | "warning"
    | "error"
    | "volume-high"
    | "volume-low"
    | "volume-muted";

  type IconSize = "micro" | "small" | "control" | "prominent";
  type IconWeight = "regular" | "bold" | "fill" | "duotone";

  const icons = {
    heart: HeartIcon,
    headphones: HeadphonesIcon,
    library: PlaylistIcon,
    sparkles: SparkleIcon,
    trash: TrashSimpleIcon,
    previous: SkipBackIcon,
    next: SkipForwardIcon,
    play: PlayIcon,
    stop: StopIcon,
    loop: RepeatIcon,
    arrow: ArrowRightIcon,
    external: ArrowSquareOutIcon,
    billing: CreditCardIcon,
    dashboard: ChartBarIcon,
    fire: FireIcon,
    waveform: WaveformIcon,
    sun: SunIcon,
    moon: MoonStarsIcon,
    ide: MonitorIcon,
    user: UserIcon,
    community: UsersThreeIcon,
    more: DotsThreeVerticalIcon,
    github: GithubLogoIcon,
    plus: PlusIcon,
    close: XIcon,
    check: CheckIcon,
    back: CaretLeftIcon,
    regenerate: ArrowClockwiseIcon,
    info: InfoIcon,
    success: CheckCircleIcon,
    warning: WarningIcon,
    error: XCircleIcon,
    "volume-high": SpeakerHighIcon,
    "volume-low": SpeakerLowIcon,
    "volume-muted": SpeakerXIcon,
  };

  const iconSizes: Record<IconSize, { pixels: number; token: string }> = {
    micro: { pixels: 10, token: "10px" },
    small: { pixels: 16, token: "var(--sol-icon-small)" },
    control: { pixels: 20, token: "var(--sol-icon-control)" },
    prominent: { pixels: 24, token: "var(--sol-icon-prominent)" },
  };

  let {
    name,
    size = "control",
    weight = "regular",
  }: { name: IconName; size?: IconSize; weight?: IconWeight } = $props();

  const Glyph = $derived(icons[name]);
</script>

<Glyph
  size={iconSizes[size].pixels}
  {weight}
  aria-hidden="true"
  focusable="false"
  style={`display: block; width: ${iconSizes[size].token}; height: ${iconSizes[size].token}; flex: 0 0 auto; overflow: visible;`}
/>
