import Tooltip from '@mui/material/Tooltip';

/** Compact icon button with an accessible label and a tooltip that can show a keyboard shortcut. */
export function ToolButton({
  label,
  shortcut,
  icon,
  active,
  disabled,
  className = '',
  placement = 'bottom',
  children,
  ref,
  ...rest
}) {
  const button = (
    <button
      ref={ref}
      type="button"
      className={`je-icon-btn${active ? ' is-active' : ''}${children ? ' has-label' : ''} ${className}`.trim()}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
      disabled={disabled}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );

  const title = shortcut ? (
    <span className="je-tooltip">
      {label}
      <kbd>{shortcut}</kbd>
    </span>
  ) : (
    label
  );

  return (
    <Tooltip title={title} placement={placement}>
      {disabled ? <span className="je-tooltip-anchor">{button}</span> : button}
    </Tooltip>
  );
}
