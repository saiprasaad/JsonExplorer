import { act, render, screen } from '@testing-library/react';
import { setPersistence } from '../utils/storage';
import { usePersistentState } from './usePersistentState';

function Probe({ id }) {
  const [format, setFormat] = usePersistentState('pathFormat', 'jsonpath');
  return (
    <button type="button" data-testid={id} onClick={() => setFormat((current) => (current === 'jq' ? 'jsonpath' : 'jq'))}>
      {format}
    </button>
  );
}

describe('usePersistentState', () => {
  afterEach(() => setPersistence(true));

  test('components using the same key stay in sync and the value is saved', () => {
    render(
      <>
        <Probe id="first" />
        <Probe id="second" />
      </>
    );
    act(() => screen.getByTestId('first').click());
    expect(screen.getByTestId('second')).toHaveTextContent('jq');
    expect(window.localStorage.getItem('json-explorer:pathFormat')).toBe('"jq"');
  });

  test('with persistence off nothing is read or written', () => {
    window.localStorage.setItem('json-explorer:pathFormat', '"pointer"');
    setPersistence(false);
    render(<Probe id="only" />);
    expect(screen.getByTestId('only')).toHaveTextContent('jsonpath');
    act(() => screen.getByTestId('only').click());
    expect(window.localStorage.getItem('json-explorer:pathFormat')).toBe('"pointer"');
  });
});
