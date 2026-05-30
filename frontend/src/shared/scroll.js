export function centerListItem(list, item) {
  // Keep cross-screen navigation visible by scrolling the target row toward
  // the center of the list.
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const nextTop =
    list.scrollTop +
    itemRect.top -
    listRect.top -
    list.clientHeight / 2 +
    item.offsetHeight / 2;

  list.scrollTo({
    top: Math.max(0, nextTop),
    behavior: "smooth"
  });
}
