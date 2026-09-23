import React, { PureComponent } from 'react';
import { withStyles } from '@material-ui/core/styles';
import TableCell from '@material-ui/core/TableCell';
import TableRow from '@material-ui/core/TableRow';
import FileExplorerTableGridRender from './FileExplorerTableBodyGridRender';
import { quickHash } from '../../../utils/funcs';
import { styles } from '../styles/FileExplorerTableBodyGridWrapperRender';

class FileExplorerTableBodyGridWrapperRender extends PureComponent {
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
    const { classes: styles, isSelected, ...parentProps } = this.props;
    const { items } = this.state;

    return (
      <TableRow>
        <TableCell colSpan={6} className={styles.gridTableCell}>
          <div className={styles.wrapper}>
            {items.map((item) => (
              <FileExplorerTableGridRender
                {...parentProps}
                key={quickHash(item.path)}
                item={item}
                isSelected={isSelected(item.path)}
              />
            ))}
          </div>
        </TableCell>
      </TableRow>
    );
  }
}

export default withStyles(styles)(FileExplorerTableBodyGridWrapperRender);
