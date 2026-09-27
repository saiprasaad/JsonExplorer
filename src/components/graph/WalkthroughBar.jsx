import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import { ToolButton } from '../ToolButton';

export const WALKTHROUGH_SPEEDS = [0.5, 1, 2, 4];

export function WalkthroughBar({ isPlaying, index, total, label, speed, onPlayPause, onPrevious, onNext, onRestart, onSpeedChange, compact }) {
  const started = index >= 0;
  return (
    <div className={`je-floating-toolbar je-walkthrough${started ? ' is-started' : ''}`} role="group" aria-label="Walkthrough">
      <button
        type="button"
        className="je-walkthrough-play"
        onClick={onPlayPause}
        disabled={total === 0}
        aria-label={isPlaying ? 'Pause walkthrough' : 'Play walkthrough'}
      >
        {isPlaying ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}
        {!started && !compact && <span>Walkthrough</span>}
      </button>
      {started && (
        <>
          <ToolButton label="Previous step" icon={<SkipPreviousRoundedIcon fontSize="small" />} onClick={onPrevious} disabled={index <= 0} placement="top" />
          <ToolButton label="Next step" icon={<SkipNextRoundedIcon fontSize="small" />} onClick={onNext} disabled={index >= total - 1} placement="top" />
          <ToolButton label="Restart" icon={<ReplayRoundedIcon fontSize="small" />} onClick={onRestart} placement="top" />
          <button
            type="button"
            className="je-walkthrough-speed"
            onClick={() => onSpeedChange(WALKTHROUGH_SPEEDS[(WALKTHROUGH_SPEEDS.indexOf(speed) + 1) % WALKTHROUGH_SPEEDS.length])}
            aria-label={`Playback speed ${speed}×, click to change`}
            title="Playback speed"
          >
            {speed}×
          </button>
          {!compact && (
            <div className="je-walkthrough-status">
              <span className="je-walkthrough-step">
                Step {index + 1} of {total}
              </span>
              <span className="je-walkthrough-label" title={label}>
                {label}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
