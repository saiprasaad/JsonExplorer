import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import DifferenceRoundedIcon from '@mui/icons-material/DifferenceRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import { ALT_KEY, shortcutLabel } from '../utils/platform';
import { ToolButton } from './ToolButton';

export const VIEWS = [
  { id: 'graph', label: 'Graph', icon: <SchemaRoundedIcon fontSize="small" />, shortcut: shortcutLabel(ALT_KEY, '1') },
  { id: 'tree', label: 'Tree', icon: <AccountTreeRoundedIcon fontSize="small" />, shortcut: shortcutLabel(ALT_KEY, '2') },
  { id: 'compare', label: 'Compare', icon: <DifferenceRoundedIcon fontSize="small" />, shortcut: shortcutLabel(ALT_KEY, '3') },
];

export function BrandMark() {
  return (
    <svg className="je-brand-mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f2635" />
      <g fill="none" stroke="#55c6b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.5 8.5c-2 0-3 1-3 3v2.2c0 1.2-.8 1.9-2 2.3 1.2.4 2 1.1 2 2.3v2.2c0 2 1 3 3 3" />
        <path d="M19.5 8.5c2 0 3 1 3 3v2.2c0 1.2.8 1.9 2 2.3-1.2.4-2 1.1-2 2.3v2.2c0 2-1 3-3 3" />
      </g>
      <circle cx="16" cy="16" r="1.9" fill="#55c6b8" />
    </svg>
  );
}

export function AppHeader({ view, onViewChange, themeMode, onToggleTheme, onShare, onShowShortcuts, compact }) {
  const handleTabKeyDown = (event) => {
    const index = VIEWS.findIndex((item) => item.id === view);
    let next = null;
    if (event.key === 'ArrowRight') next = VIEWS[(index + 1) % VIEWS.length];
    if (event.key === 'ArrowLeft') next = VIEWS[(index - 1 + VIEWS.length) % VIEWS.length];
    if (event.key === 'Home') next = VIEWS[0];
    if (event.key === 'End') next = VIEWS[VIEWS.length - 1];
    if (next) {
      event.preventDefault();
      onViewChange(next.id);
      event.currentTarget.querySelector(`[data-view="${next.id}"]`)?.focus();
    }
  };

  return (
    <header className="je-header">
      <h1 className="je-brand">
        <BrandMark />
        <span className={compact ? 'je-visually-hidden' : 'je-brand-name'}>JSON Explorer</span>
      </h1>

      <div className="je-tabs" role="tablist" aria-label="Views" onKeyDown={handleTabKeyDown}>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`je-tab-${item.id}`}
            data-view={item.id}
            aria-selected={view === item.id}
            aria-controls={`je-panel-${item.id === 'compare' ? 'compare' : 'explore'}`}
            tabIndex={view === item.id ? 0 : -1}
            className="je-tab"
            title={`${item.label} (${item.shortcut})`}
            onClick={() => onViewChange(item.id)}
          >
            {item.icon}
            <span className="je-tab-label">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="je-header-actions">
        <ToolButton label="Copy shareable link" icon={<LinkRoundedIcon fontSize="small" />} onClick={onShare} className="je-share-btn">
          {!compact && <span>Share</span>}
        </ToolButton>
        <ToolButton
          label={themeMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          icon={themeMode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
          onClick={onToggleTheme}
        />
        {!compact && (
          <ToolButton label="Keyboard shortcuts" shortcut="?" icon={<KeyboardRoundedIcon fontSize="small" />} onClick={onShowShortcuts} />
        )}
      </div>
    </header>
  );
}
