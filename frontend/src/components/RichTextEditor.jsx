import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';

const MenuBar = ({ editor }) => {
    if (!editor) {
        return null;
    }

    return (
        <div className="editor-toolbar">
            <button
                type="button"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().chain().focus().undo().run()}
                className="toolbar-btn"
                title="Undo"
            >
                ↩
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().chain().focus().redo().run()}
                className="toolbar-btn"
                title="Redo"
            >
                ↪
            </button>
            <div className="toolbar-divider" />
            
            <select
                className="toolbar-select"
                onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
                value={editor.getAttributes('textStyle').fontFamily || 'sans-serif'}
            >
                <option value="sans-serif">Sans Serif</option>
                <option value="serif">Serif</option>
                <option value="monospace">Monospace</option>
            </select>

            <div className="toolbar-divider" />

            <button
                type="button"
                onClick={() => {
                    const level = editor.isActive('heading', { level: 1 }) ? 2 : editor.isActive('heading', { level: 2 }) ? 3 : editor.isActive('heading', { level: 3 }) ? 0 : 1;
                    if (level === 0) editor.chain().focus().setParagraph().run();
                    else editor.chain().focus().toggleHeading({ level }).run();
                }}
                className={`toolbar-btn ${editor.isActive('heading') ? 'is-active' : ''}`}
                title="Text Size"
                style={{ position: 'relative' }}
            >
                T<span style={{ fontSize: 10, position: 'absolute', top: 2, right: 2 }}>↑</span>
            </button>
            
            <div className="toolbar-divider" />

            <button
                type="button"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={`toolbar-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
                title="Bold"
                style={{ fontWeight: 'bold' }}
            >
                B
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
                title="Italic"
                style={{ fontStyle: 'italic' }}
            >
                I
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                className={`toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
                title="Underline"
                style={{ textDecoration: 'underline' }}
            >
                U
            </button>
            <input
                type="color"
                onInput={event => editor.chain().focus().setColor(event.target.value).run()}
                value={editor.getAttributes('textStyle').color || '#000000'}
                className="toolbar-color-picker"
                title="Text Color"
            />

            <div className="toolbar-divider" />

            <select
                className="toolbar-select"
                onChange={(e) => editor.chain().focus().setTextAlign(e.target.value).run()}
                value={
                    editor.isActive({ textAlign: 'justify' }) ? 'justify' :
                    editor.isActive({ textAlign: 'right' }) ? 'right' :
                    editor.isActive({ textAlign: 'center' }) ? 'center' : 'left'
                }
            >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
            </select>

            <div className="toolbar-divider" />

            <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
                title="Ordered List"
            >
                1.
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
                title="Unordered List"
            >
                •
            </button>
            
            <button
                type="button"
                onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
                disabled={!editor.can().sinkListItem('listItem')}
                className="toolbar-btn"
                title="Increase Indent"
            >
                ⇥
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().liftListItem('listItem').run()}
                disabled={!editor.can().liftListItem('listItem')}
                className="toolbar-btn"
                title="Decrease Indent"
            >
                ⇤
            </button>
            
            <div className="toolbar-divider" />

            <button
                type="button"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={`toolbar-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
                title="Blockquote"
            >
                ""
            </button>

            <button
                type="button"
                onClick={() => {
                    const previousUrl = editor.getAttributes('link').href;
                    const url = window.prompt('URL', previousUrl);
                    if (url === null) return;
                    if (url === '') {
                        editor.chain().focus().extendMarkRange('link').unsetLink().run();
                        return;
                    }
                    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                }}
                className={`toolbar-btn ${editor.isActive('link') ? 'is-active' : ''}`}
                title="Insert Link"
            >
                🔗
            </button>

            <div className="toolbar-divider" />

            <button
                type="button"
                onClick={() => editor.chain().focus().unsetAllMarks().run()}
                className="toolbar-btn"
                title="Clear Formatting"
            >
                <span style={{ textDecoration: 'line-through' }}>X</span>
            </button>

        </div>
    );
};

export default function RichTextEditor({ content, onChange, placeholder = '' }) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            TextStyle,
            FontFamily,
            Color,
            Underline,
            Link.configure({ openOnClick: false }),
        ],
        content: content,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML();
            // Handle edge case where tiptap returns '<p></p>' when empty
            onChange(html === '<p></p>' ? '' : html);
        },
        editable: true,
        editorProps: {
            attributes: {
                class: 'tiptap',
            },
            // Try to set placeholder on empty editor
            transformPastedHTML(html) {
                return html;
            }
        }
    });

    return (
        <div className="editor-container" style={{ position: 'relative' }}>
            <MenuBar editor={editor} />
            <EditorContent editor={editor} />
            {editor && editor.isEmpty && placeholder && (
                <div 
                    style={{
                        position: 'absolute',
                        top: 56, // below toolbar
                        left: 17,
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                        fontSize: 15,
                        fontFamily: 'inherit'
                    }}
                >
                    {placeholder}
                </div>
            )}
        </div>
    );
}
