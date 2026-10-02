import './guard';
import { afterEach, describe, expect, test } from 'bun:test';
import DirectoryWindow from '../../app/containers/HomePage/components/DirectoryWindow';

const savedResizeObserver = globalThis.ResizeObserver;
const savedCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.ResizeObserver = savedResizeObserver;
  globalThis.cancelAnimationFrame = savedCancelAnimationFrame;
});

function createWindow(items, extraProps = {}) {
  const listeners = new Map();
  const scroller = {
    scrollTop: 0,
    clientHeight: 800,
    clientWidth: 600,
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  const anchor = {
    closest: () => ({ parentElement: scroller }),
    getBoundingClientRect: () => ({ top: 50 - scroller.scrollTop }),
    clientWidth: 600,
    nextElementSibling: { getBoundingClientRect: () => ({ height: 54 }) },
  };
  let disconnected = false;

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  globalThis.cancelAnimationFrame = () => {};

  const component = new DirectoryWindow({
    items,
    rowHeight: 54,
    children: (value) => value,
    ...extraProps,
  });

  component.setState = (state) => {
    component.state = { ...component.state, ...state };
  };
  component.setAnchor(anchor);
  component.componentDidMount();

  return { component, scroller, listeners, isDisconnected: () => disconnected };
}

describe('DirectoryWindow lifecycle', () => {
  test('scrolling reaches the end, sorting immediately replaces rows, and cleanup removes listeners', () => {
    const items = Array.from({ length: 10000 }, (_, index) => ({
      path: `/${index}`,
    }));
    const { component, scroller, listeners, isDisconnected } = createWindow(
      items,
      {
        measureRow: true,
      },
    );

    expect(component.render().items[0]).toBe(items[0]);
    expect(component.render().items.length).toBeLessThan(30);
    scroller.scrollTop = items.length * 54 - 750;
    component.measure();
    expect(component.render().items.at(-1)).toBe(items.at(-1));

    const previous = component.props;
    component.props = { ...previous, items: [...items].reverse() };
    component.componentDidUpdate(previous);
    expect(scroller.scrollTop).toBe(0);
    expect(component.render().items[0]).toBe(items.at(-1));
    expect(listeners.has('scroll')).toBe(true);
    component.componentWillUnmount();
    expect(listeners.size).toBe(0);
    expect(isDisconnected()).toBe(true);
  });

  test('selection rerenders preserve scroll and item identity', () => {
    const items = Array.from({ length: 10000 }, (_, index) => ({
      path: `/${index}`,
    }));
    const { component, scroller } = createWindow(items);

    scroller.scrollTop = 54050;
    component.measure();
    const before = component.render();
    const previous = component.props;
    component.props = { ...previous, children: (value) => value };
    component.componentDidUpdate(previous);
    const after = component.render();

    expect(scroller.scrollTop).toBe(54050);
    expect(after.items[0]).toBe(before.items[0]);
    expect(after.items.at(-1)).toBe(before.items.at(-1));
    component.componentWillUnmount();
  });
});
