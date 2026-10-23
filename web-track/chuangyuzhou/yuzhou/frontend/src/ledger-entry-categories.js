export const entryCategories = {
  expense: ['餐饮', '交通', '学习', '学习用品', '购物', '活动', '住房', '其他支出'],
  income: ['生活费', '兼职', '报销', '奖学金', '其他收入']
};

// Historical labels remain usable, including labels on archived accounts.
export function entryCategoryOptions(ledger, type, current = '') {
  return [...new Set([
    ...entryCategories[type],
    ...ledger.entries.filter(entry => entry.type === type).map(entry => entry.category),
    current
  ].filter(Boolean))];
}

export function categoryAfterTypeChange(current, nextType) {
  const presets = Object.values(entryCategories).flat();
  return !current || (presets.includes(current) && !entryCategories[nextType].includes(current))
    ? entryCategories[nextType][0] : current;
}
