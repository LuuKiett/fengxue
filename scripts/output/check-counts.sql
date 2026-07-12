SELECT band, level, count(*) as cnt FROM public.dictionary_words GROUP BY band, level ORDER BY band, level;
