const copy = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
function fakeDB(initial = {}) {
  const data = Object.fromEntries(Object.entries(initial).map(([key, rows]) => [key, copy(rows)]));
  const command = { in: values => ({ operator: 'in', values }), all: values => ({ operator: 'all', values }), lt: value => ({ operator: 'lt', value }), inc: value => ({ operator: 'inc', value }), set: value => ({ operator: 'set', value }), remove: () => ({ operator: 'remove' }) };
  const matches = (row, where) => Object.entries(where).every(([key, expected]) => {
    const value = row[key];
    if (expected && expected.operator === 'in') return expected.values.includes(value);
    if (expected && expected.operator === 'all') return Array.isArray(value) && expected.values.every(item => value.includes(item));
    if (expected && expected.operator === 'lt') return value < expected.value;
    return value === expected;
  });
  function collection(name) {
    if (!data[name]) data[name] = [];
    const query = { where: {}, order: [], skip: 0, limit: 1000 };
    const api = {
      where(where) { query.where = where; return api; },
      orderBy(field, direction) { query.order.push([field, direction]); return api; },
      skip(skip) { query.skip = skip; return api; },
      limit(limit) { query.limit = limit; return api; },
      async get() {
        let rows = data[name].filter(row => matches(row, query.where));
        for (const [field, direction] of query.order.slice().reverse()) rows = rows.slice().sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
        return { data: copy(rows.slice(query.skip, query.skip + query.limit)) };
      },
      async count() { return { total: data[name].filter(row => matches(row, query.where)).length }; },
      async add({ data: row }) { data[name].push(copy(row)); return { _id: row._id }; },
      async update({ data: values }) { for (const row of data[name].filter(row => matches(row, query.where))) apply(row, values); return {}; },
      doc(id) {
        return {
          async get() { const row = data[name].find(row => row._id === id); if (!row) throw new Error('DOCUMENT_NOT_FOUND'); return { data: copy(row) }; },
          async set({ data: row }) { const index = data[name].findIndex(row => row._id === id); const value = { ...copy(row), _id: id }; if (index < 0) data[name].push(value); else data[name][index] = value; return {}; },
          async update({ data: values }) { const row = data[name].find(row => row._id === id); if (!row) throw new Error('DOCUMENT_NOT_FOUND'); apply(row, values); return {}; },
        };
      },
    };
    return api;
  }
  function apply(row, values) {
    for (const [key, value] of Object.entries(values)) {
      if (value && value.operator === 'remove') delete row[key];
      else if (value && value.operator === 'set') row[key] = copy(value.value);
      else if (value && value.operator === 'inc') row[key] = (row[key] || 0) + value.value;
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!row[key] || typeof row[key] !== 'object' || Array.isArray(row[key])) row[key] = {};
        apply(row[key], value);
      } else row[key] = copy(value);
    }
  }
  return { data, collection, command, async runTransaction(callback) { const before = copy(data); try { return await callback({ collection }); } catch (error) { for (const key of Object.keys(data)) delete data[key]; Object.assign(data, before); throw error; } } };
}
module.exports = { fakeDB };
