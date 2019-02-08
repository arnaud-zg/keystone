/** @jsx jsx */
import { jsx } from '@emotion/core';
import { useRef, Fragment, useLayoutEffect, useMemo, forwardRef, useState } from 'react';
import { Editor } from 'slate-react';
import { Block } from 'slate';
import { getVisibleSelectionRect } from 'get-selection-range';
import { createPortal } from 'react-dom';
import { Popper } from 'react-popper';
import { marks, markTypes, plugins as markPlugins } from './marks';
import { type as defaultType } from './blocks/paragraph';
import AddBlock from './AddBlock';
import { ToolbarButton } from './toolbar-components';
import { A11yText } from '@arch-ui/typography';
import { CircleSlashIcon } from '@arch-ui/icons';
import ResizeObserver from 'resize-observer-polyfill';
import { selectionReference } from './utils';
import { mediaQueries } from '@arch-ui/common';
import { useMediaQuery, useFocus } from './hooks';

function getSchema(blocks) {
  const schema = {
    document: {
      last: { type: defaultType },
      normalize: (editor, { code, node }) => {
        switch (code) {
          case 'last_child_type_invalid': {
            const paragraph = Block.create(defaultType);
            return editor.insertNodeByKey(node.key, node.nodes.size, paragraph);
          }
        }
      },
    },
    blocks: {},
  };
  Object.keys(blocks).forEach(type => {
    if (blocks[type].schema !== undefined) {
      schema.blocks[type] = blocks[type].schema;
    }
  });
  return schema;
}

function useHasSelection() {
  let [hasSelection, setHasSelection] = useState(false);
  useLayoutEffect(() => {
    const rect = getVisibleSelectionRect();
    let newValue = rect && rect.width !== 0;
    setHasSelection(newValue);
  });
  return hasSelection;
}

let stopPropagation = e => {
  e.stopPropagation();
};

function MarkButton({ editor, editorState, mark }) {
  let isActive = editorState.activeMarks.some(activeMark => activeMark.type === mark.name);
  return useMemo(
    () => (
      <ToolbarButton
        isActive={isActive}
        onClick={() => {
          editor.toggleMark(mark.name);
        }}
      >
        <mark.icon />
        <A11yText>{mark.label}</A11yText>
      </ToolbarButton>
    ),
    [editor, isActive, mark]
  );
}

function EditorToolbar({ blocks, editor, editorState }) {
  return Object.keys(blocks)
    .map(x => blocks[x].Toolbar)
    .filter(x => x)
    .reduce(
      (children, Toolbar) => {
        return (
          <Toolbar editor={editor} editorState={editorState}>
            {children}
          </Toolbar>
        );
      },
      <Fragment>
        {Object.keys(marks).map(name => {
          return (
            <MarkButton mark={marks[name]} editor={editor} editorState={editorState} key={name} />
          );
        })}
        <ToolbarButton
          onClick={() => {
            markTypes.forEach(mark => {
              editor.removeMark(mark);
            });
          }}
        >
          <CircleSlashIcon title="Remove Formatting" />
        </ToolbarButton>

        {Object.keys(blocks).map(type => {
          let ToolbarElement = blocks[type].ToolbarElement;
          if (ToolbarElement === undefined) {
            return null;
          }
          return <ToolbarElement key={type} editor={editor} editorState={editorState} />;
        })}
      </Fragment>
    );
}
const PopperRender = forwardRef(({ scheduleUpdate, editorState, style, children }, ref) => {
  useLayoutEffect(scheduleUpdate, [editorState]);

  let shouldShowToolbar = useHasSelection();

  let [toolbarElement, setToolbarElement] = useState(null);

  let observerRef = useRef(null);

  useLayoutEffect(
    () => {
      if (toolbarElement !== null) {
        let rect = toolbarElement.getBoundingClientRect();
        let previousHeight = Math.round(rect.height);
        let previousWidth = Math.round(rect.width);
        observerRef.current = new ResizeObserver(entries => {
          let entry = entries[0];
          let { height, width } = entry.contentRect;
          height = Math.round(height);
          width = Math.round(width);
          if (
            (height !== previousHeight || width !== previousWidth) &&
            height !== 0 &&
            width !== 0
          ) {
            previousHeight = height;
            previousWidth = width;
            scheduleUpdate();
          }
        });
      }
    },
    [scheduleUpdate, toolbarElement]
  );

  useLayoutEffect(
    () => {
      if (shouldShowToolbar && toolbarElement !== null) {
        let observer = observerRef.current;
        observer.observe(toolbarElement);
        return () => {
          observer.unobserve(toolbarElement);
        };
      }
    },
    [shouldShowToolbar, toolbarElement, scheduleUpdate]
  );

  return createPortal(
    <div
      onMouseDown={stopPropagation}
      ref={ref}
      style={style}
      css={{
        backgroundColor: 'black',
        padding: 8,
        borderRadius: 6,
        width: 'auto',
        position: 'absolute',
        display: shouldShowToolbar ? 'flex' : 'none',
        left: 0,
        top: 0,
        // this isn't as nice of a transition as i'd like since the time is fixed
        // i think it would better if it was physics based but that would probably
        // be a lot of work for little gain
        // maybe base the transition time on the previous value?
        transition: 'transform 100ms',
      }}
    >
      {shouldShowToolbar && (
        <div css={{ display: 'flex' }} ref={setToolbarElement}>
          {children}
        </div>
      )}
    </div>,
    document.body
  );
});

function Stories({ value: editorState, onChange, blocks, className }) {
  let schema = useMemo(
    () => {
      return getSchema(blocks);
    },
    [blocks]
  );

  let plugins = useMemo(
    () => {
      let combinedPlugins = [
        ...markPlugins,
        {
          renderNode(props) {
            let block = blocks[props.node.type];
            if (block) {
              return <block.Node {...props} />;
            }
            return null;
          },
        },
      ];

      Object.keys(blocks).forEach(type => {
        let blockTypePlugins = blocks[type].plugins;
        if (blockTypePlugins !== undefined) {
          combinedPlugins.push(...blockTypePlugins);
        }
      });
      return combinedPlugins;
    },
    [blocks]
  );
  let containerRef = useRef(null);

  let isFocussed = useFocus(containerRef);

  let [editor, setEditor] = useState(null);
  let shouldUseFixedToolbar = useMediaQuery(mediaQueries.mdDown);
  return (
    <div ref={containerRef} className={className}>
      <Editor
        schema={schema}
        ref={setEditor}
        plugins={plugins}
        value={editorState}
        onChange={({ value }) => {
          onChange(value);
        }}
      />
      <AddBlock editor={editor} editorState={editorState} blocks={blocks} />
      {isFocussed ? (
        shouldUseFixedToolbar ? (
          <FixedToolbar>
            <EditorToolbar {...{ editorState, blocks, editor }} />
          </FixedToolbar>
        ) : (
          <Popper placement="top" referenceElement={selectionReference}>
            {({ style, ref, scheduleUpdate }) => (
              <PopperRender {...{ scheduleUpdate, editorState, style, ref }}>
                <EditorToolbar {...{ editorState, blocks, editor }} />
              </PopperRender>
            )}
          </Popper>
        )
      ) : null}
    </div>
  );
}

export default Stories;

function FixedToolbar({ children }) {
  return createPortal(
    <div
      onMouseDown={stopPropagation}
      css={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        display: 'flex',
        backgroundColor: 'black',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
