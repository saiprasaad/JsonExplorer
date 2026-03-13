import { render, screen } from '@testing-library/react';
import App from './App';

test('renders JSON Editor heading', () => {
  render(<App />);
  const heading = screen.getByText(/JSON Editor/i);
  expect(heading).toBeInTheDocument();
});
