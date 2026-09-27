import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Broken() {
  throw new Error('Rendering failed');
}

describe('ErrorBoundary', () => {
  test('shows the error with a way to retry and, optionally, to start over', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onStartOver = jest.fn();
    render(
      <ErrorBoundary onStartOver={onStartOver} startOverLabel="Clear the saved document and reload">
        <Broken />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Rendering failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the saved document and reload' }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
