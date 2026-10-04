import { Emitter, type Unsubscribe } from '../core/emitter';

/** Common change-notification plumbing for services. */
export class ObservableService {
  private changeBus = new Emitter<{ change: void }>();
  onChange(handler: () => void): Unsubscribe {
    return this.changeBus.on('change', handler);
  }
  protected notify() {
    this.changeBus.emit('change', undefined);
  }
}
