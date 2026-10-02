import React, { PureComponent } from 'react';
import { directoryWindow } from '../../../utils/directoryWindow';

// Uses the existing explorer scroll container, retaining the table, headers,
// row components and event handlers while mounting only nearby entries.
export default class DirectoryWindow extends PureComponent {
  state = { scrollTop: 0, height: 800, width: 600, measuredRowHeight: null };

  componentDidMount() {
    this.scroller = this.anchor.closest('table').parentElement;
    this.scroller.addEventListener('scroll', this.scheduleMeasure, {
      passive: true,
    });
    this.resizeObserver = new ResizeObserver(this.scheduleMeasure);
    this.resizeObserver.observe(this.scroller);
    this.measure();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.items !== this.props.items) {
      // A new directory or ordering starts at its first item, as the old
      // incremental renderer did when it temporarily emptied the table.
      this.scroller.scrollTop = 0;
      this.measure();
    }
  }

  componentWillUnmount() {
    this.scroller?.removeEventListener('scroll', this.scheduleMeasure);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  setAnchor = (node) => {
    this.anchor = node;
  };

  scheduleMeasure = () => {
    if (this.frame) {
      return;
    }

    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.measure();
    });
  };

  measure = () => {
    const { scroller, anchor } = this;
    const origin =
      anchor.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const row = this.props.measureRow ? anchor.nextElementSibling : null;
    const measuredRowHeight = row?.getBoundingClientRect().height || null;

    this.setState({
      scrollTop: Math.max(0, scroller.scrollTop - origin),
      height: scroller.clientHeight,
      width: this.props.tileWidth ? anchor.clientWidth : scroller.clientWidth,
      measuredRowHeight,
    });
  };

  render() {
    const { items, rowHeight, tileWidth, children } = this.props;
    const { scrollTop, height, width, measuredRowHeight } = this.state;
    const columns = tileWidth ? Math.max(1, Math.floor(width / tileWidth)) : 1;
    const range = directoryWindow({
      count: items.length,
      columns,
      rowHeight: measuredRowHeight || rowHeight,
      viewportHeight: height,
      scrollTop,
    });

    return children({
      items: items.slice(range.start, range.end),
      before: range.before,
      after: range.after,
      anchorRef: this.setAnchor,
    });
  }
}
