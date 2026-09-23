import React, { PureComponent } from 'react';
import FileExplorerTableRowsRender from './FileExplorerTableBodyListRender';
import { quickHash } from '../../../utils/funcs';

export default class FileExplorerTableBodyListWrapperRender extends PureComponent {
  constructor(props) {
    super(props);

    this.recursiveFilesFetchTimeOut = null;
    this.filesPreFetchCount = 50;
    this.loadedCount = 0;
    this.state = {
      items: [],
      directoryGeneratedTime: props.directoryGeneratedTime,
    };
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.directoryGeneratedTime !== prevState.directoryGeneratedTime) {
      return {
        directoryGeneratedTime: nextProps.directoryGeneratedTime,
        items: [],
      };
    }

    return null;
  }

  componentDidMount() {
    const { tableSort, directoryGeneratedTime } = this.props;

    this.loadedCount = 0;
    this.recursiveFilesFetch(tableSort, directoryGeneratedTime);
  }

  componentDidUpdate(prevProps) {
    const { tableSort, directoryGeneratedTime } = this.props;

    if (prevProps.directoryGeneratedTime !== directoryGeneratedTime) {
      this.clearRecursiveFilesFetchTimeOut();
      this.loadedCount = 0;
      this.recursiveFilesFetch(tableSort, directoryGeneratedTime);
    }
  }

  componentWillUnmount() {
    this.clearRecursiveFilesFetchTimeOut();
  }

  recursiveFilesFetch = (tableSort, directoryGeneratedTime) => {
    this.recursiveFilesFetchTimeOut = setTimeout(() => {
      if (directoryGeneratedTime !== this.props.directoryGeneratedTime) {
        return;
      }

      const nextLength = Math.min(
        this.loadedCount + this.filesPreFetchCount,
        tableSort.length,
      );
      const hasMore = nextLength < tableSort.length;

      this.loadedCount = nextLength;
      this.setState({
        items: tableSort.slice(0, nextLength),
      });

      if (hasMore) {
        this.recursiveFilesFetch(tableSort, directoryGeneratedTime);
      } else {
        this.clearRecursiveFilesFetchTimeOut();
      }
    }, 0);
  };

  clearRecursiveFilesFetchTimeOut() {
    if (this.recursiveFilesFetchTimeOut) {
      clearTimeout(this.recursiveFilesFetchTimeOut);
      this.recursiveFilesFetchTimeOut = null;
    }
  }

  render() {
    const { isSelected, ...parentProps } = this.props;
    const { items } = this.state;

    return items.map((item) => (
      <FileExplorerTableRowsRender
        {...parentProps}
        key={quickHash(item.path)}
        item={item}
        isSelected={isSelected(item.path)}
      />
    ));
  }
}
