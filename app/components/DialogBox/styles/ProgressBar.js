export const styles = (_) => ({
  root: {
    flexGrow: 1,
  },
  dialogFixMultipleProgressPadding: {
    marginTop: 35,
  },
  dialogContentTextTop: {
    marginBottom: 10,
    fontSize: 14,
    // Transfer labels update every tick (%, bytes, ETA); tabular figures
    // keep the dialog from reflowing as digits change.
    fontVariantNumeric: 'tabular-nums',
  },
  dialogContentTextBottom: {
    marginTop: 10,
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums',
  },
  dialogTitleInnerWrapper: {
    alignItems: `center`,
  },
  helpText: {
    float: `right`,
  },
  titleText: {
    float: `left`,
    fontSize: 17,
  },
  bottomText: {
    fontSize: 10,
    fontWeight: 400,
    padding: '0px 0 15px 0',
    fontVariantNumeric: 'tabular-nums',
  },
  childrenWrapper: {
    padding: '0px 0 5px 0',
  },
});
