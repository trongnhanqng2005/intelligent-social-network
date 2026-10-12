import './home-page.css';
import { useApiHealth } from './model/use-api-health';

export function HomePage() {
  const { state, retry } = useApiHealth();
  const statusLabel = {
    loading: 'Checking',
    success: 'Connected',
    error: 'Unavailable',
  }[state.status];
  const statusMessage =
    state.status === 'loading'
      ? 'Checking API connection.'
      : state.status === 'success'
        ? 'The API is responding normally.'
        : state.message;

  return (
    <div className="home-shell">
      <header className="site-header">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">
            ISN
          </span>
          <span>Intelligent Social Network</span>
        </div>
        <p className="header-note">Application foundation</p>
      </header>

      <main className="home-main">
        <section aria-labelledby="page-title" className="home-intro">
          <p className="eyebrow">A connected starting point</p>
          <h1 id="page-title">A foundation to build on.</h1>
          <p className="home-lede">
            A small, responsive starting point for the Intelligent Social Network.
            Check the API connection before adding the next layer.
          </p>
          <div
            aria-label="Application stack"
            className="foundation-details"
            role="group"
          >
            <span>STACK</span>
            <span>NestJS 12</span>
            <span aria-hidden="true" className="detail-divider" />
            <span>React 19</span>
          </div>
        </section>

        <section
          aria-labelledby="api-connection-title"
          aria-busy={state.status === 'loading'}
          className="health-card"
        >
          <span className={`status-label status-label--${state.status}`}>
            <span
              aria-hidden="true"
              className={`status-dot status-dot--${state.status}`}
            />
            {statusLabel}
          </span>
          <h2 id="api-connection-title">API connection</h2>
          <p
            aria-live={state.status === 'error' ? 'assertive' : 'polite'}
            className="health-description"
            role={state.status === 'error' ? 'alert' : 'status'}
          >
            {statusMessage}
          </p>
          {state.status === 'error' && (
            <button className="retry-button" onClick={retry} type="button">
              Retry connection
            </button>
          )}
          <div className="endpoint-row">
            <span className="endpoint-label">Health endpoint</span>
            <code className="endpoint-value">GET /health</code>
          </div>
        </section>
      </main>

      <footer className="page-footer">
        <span>Development foundation</span>
        <span>Local environment</span>
      </footer>
    </div>
  );
}
