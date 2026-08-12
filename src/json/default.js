export function createEmptyDocument(slug = '', category = '') {
  const now = new Date().toISOString();
  return {
    slug,
    title: '',
    summary: '',
    category,
    word_count: 0,
    category_name: '',
    full_text: '',
    body: [],
    images: [],
    core_properties: {
      title: '',
      subject: '',
      author: '',
      last_modified_by: '',
      created: now,
      modified: now,
      category: '',
      comments: '',
      keywords: '',
      language: '',
      revision: 0,
    },
  };
}
