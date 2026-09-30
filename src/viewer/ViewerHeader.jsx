import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import Tooltip from '@mui/material/Tooltip';
import { BrandMark } from '../components/AppHeader';
import { ToolButton } from '../components/ToolButton';

const PRIVACY =
  'This page contains your data and runs entirely in your browser. Its Content Security Policy blocks every network request, so nothing is sent anywhere.';

export function ViewerHeader({ title, meta, themeMode, onToggleTheme, generator, children }) {
  return (
    <header className="je-header je-viewer-header">
      <h1 className="je-brand" title={generator ? `Made with ${generator}` : undefined}>
        <BrandMark />
        <span className="je-viewer-title">
          <span className="je-viewer-name" title={title}>
            {title}
          </span>
          <span className="je-viewer-meta">{meta}</span>
        </span>
      </h1>
      {children}
      <div className="je-header-actions">
        <Tooltip title={PRIVACY} arrow>
          <span className="je-privacy-badge" tabIndex={0} aria-label={`Offline and private. ${PRIVACY}`}>
            <LockRoundedIcon fontSize="inherit" aria-hidden="true" /> Offline
          </span>
        </Tooltip>
        <ToolButton
          label={themeMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          icon={themeMode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
          onClick={onToggleTheme}
        />
      </div>
    </header>
  );
}
