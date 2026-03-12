import React, { useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const languageExtensions = {
  javascript: () => javascript({ jsx: true }),
  python: () => python(),
  html: () => html(),
  css: () => css(),
  json: () => json(),
};

export function CodeEditor({ code, language, readOnly, onChange }) {
  const handleChange = useCallback((value) => {
    if (!readOnly && onChange) {
      onChange(value);
    }
  }, [readOnly, onChange]);

  const langExt = languageExtensions[language];
  const extensions = langExt ? [langExt()] : [javascript({ jsx: true })];

  return (
    <div className="h-full w-full" data-testid="code-editor">
      <CodeMirror
        value={code}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={handleChange}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
