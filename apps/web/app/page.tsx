import messages from '../messages/vi.json';
import { SystemStatus } from './system-status';
export default function Overview() {
  return (
    <>
      <div className="page-heading">
        <span className="small-label">{messages.phase}</span>
        <h1>{messages.title}</h1>
        <p>{messages.intro}</p>
      </div>
      <SystemStatus />
      <section className="next-step">
        <span className="step-number" aria-hidden="true">
          01
        </span>
        <div>
          <h2>{messages.nextTitle}</h2>
          <p>{messages.nextDescription}</p>
        </div>
      </section>
      <p className="roadmap-line">{messages.scope}</p>
    </>
  );
}
