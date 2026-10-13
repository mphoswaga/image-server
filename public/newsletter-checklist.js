/* Extract only explicitly headed family actions; never infer dates or tasks. */
(function (root) {
  const headings = {
    homework: /^(homework|bài tập về nhà)$/i,
    bring:
      /^(things to bring|what to bring|đồ dùng cần mang|đồ dùng cần mang theo)$/i,
    dates:
      /^(important dates|dates to remember|ngày quan trọng|các ngày quan trọng)$/i,
    talk: /^(conversation starter[s]?|how can you help at home\??|at home|câu hỏi trò chuyện|ba mẹ có thể đồng hành cùng con tại nhà như thế nào\??)$/i,
  };
  function extract(entries, lang) {
    const result = [];
    for (const entry of entries || []) {
      let category = null,
        content = [];
      const flush = () => {
        const text = content.join("\n").trim();
        if (category && text)
          result.push({ subject: entry.subject, category, text });
        content = [];
      };
      for (const line of String(
        entry[lang === "vi" ? "vietnamese" : "english"] || "",
      ).split("\n")) {
        const clean = line
          .trim()
          .replace(/^#{1,4}\s+/, "")
          .replace(/\*\*/g, "");
        const split = clean.match(/^([^:：]+)[:：]\s*(.*)$/);
        const label = (split ? split[1] : clean).trim();
        const key = Object.keys(headings).find((k) => headings[k].test(label));
        if (key) {
          flush();
          category = key;
          if (split?.[2]) content.push(split[2]);
        } else if (
          !clean ||
          /[:：]$/.test(clean) ||
          /^(key vocabulary|từ vựng chính)$/i.test(clean)
        ) {
          flush();
          category = null;
        } else if (category) content.push(line.trim());
      }
      flush();
    }
    return result;
  }
  if (typeof module !== "undefined") module.exports = { extract };
  else root.NewsletterChecklist = { extract };
})(typeof window !== "undefined" ? window : globalThis);
