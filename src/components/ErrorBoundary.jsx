import React from 'react';

/**
 * Catches rendering errors in a view. Changing `resetKey` (e.g. new JSON) clears the error.
 * `onStartOver` adds a second way out, for errors that would otherwise come back on every retry.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="je-empty" role="alert">
          <div className="je-empty-card is-error">
            <h2>Something went wrong</h2>
            <p>{this.state.error.message || 'An unexpected error occurred while rendering.'}</p>
            <div className="je-empty-actions">
              <button type="button" className="je-button" onClick={this.handleReset}>
                Try again
              </button>
              {this.props.onStartOver && (
                <button type="button" className="je-button is-primary" onClick={this.props.onStartOver}>
                  {this.props.startOverLabel || 'Start over'}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
