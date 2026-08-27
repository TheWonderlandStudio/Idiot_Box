// Visual Builder — Full Craft.js (https://github.com/prevwong/craft.js) — JSX / TSX / HTML
// Implements Craft.js tutorial + docs concepts: nodes, connectors, canvas, droppable regions, rules, resolver, serialize
import React, { useState, useEffect, useCallback } from "react";
import { Editor, Frame, Element, useEditor, useNode } from "@craftjs/core";
import { Layers as CraftLayers } from "@craftjs/layers";
import {
  Heading1, Type, Square, Box, Image as ImageIcon, Minus, MousePointerClick,
  TextCursorInput, Container as ContainerIcon, Layers, Settings2, Trash2, Copy,
  Eye, Code2, Save, RefreshCw, FilePlus, Download, Palette, Move, Undo2, Redo2, FileCode, FileText, Search, X
} from "lucide-react";
import { useInputDialog } from "../shared/InputDialog.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const lb = { fontSize: 11, color: "#bbb", fontWeight: 600 };
const inp = { background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#ddd", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" };
const Slider = ({ label, value, min, max, onChange }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 2 }}><span>{label}</span><span>{value}</span></div>
    <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value))} style={{ width: "100%" }} />
  </div>
);
const Color = ({ label, value, onChange }) => (
  <div>
    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{label}</div>
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 32, height: 26, border: "1px solid #3a3a3a", borderRadius: 4, background: "transparent", padding: 2 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp, flex: 1 }} />
    </div>
  </div>
);
const Select = ({ label, value, options, onChange }) => (
  <div>
    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{label}</div>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inp}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// ── User Components (Craft.js tutorial based, extended for HTML elements) ────
export const Container = ({ background, padding, gap, display, flexDirection, borderRadius, border, children }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((node) => ({
    selected: node.events.selected, hovered: node.events.hovered,
  }));
  return (
    <div
      ref={(ref) => connect(drag(ref))}
      style={{
        background: background || "#ffffff", padding: padding ?? 16,
        display: display || "block", flexDirection: flexDirection || "column",
        gap: gap ?? 12, borderRadius: borderRadius ?? 8,
        border: border || (selected ? "1.5px solid #4ec9b0" : hovered ? "1px dashed #569cd6" : "1px dashed #e5e7eb"),
        minHeight: 60, minWidth: 40,
        boxShadow: selected ? "0 0 0 2px rgba(78,201,176,0.15)" : "none",
      }}
    >
      {children}
    </div>
  );
};
Container.craft = {
  displayName: "Container",
  props: { background: "#ffffff", padding: 16, gap: 12, display: "flex", flexDirection: "column", borderRadius: 8, border: "" },
  rules: { canDrag: () => true },
  related: { settings: ContainerSettings },
};
function ContainerSettings() {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Slider label="Padding" value={props.padding} min={0} max={48} onChange={(v) => setProp((p) => (p.padding = v))} />
      <Slider label="Gap" value={props.gap} min={0} max={32} onChange={(v) => setProp((p) => (p.gap = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Select label="Display" value={props.display} options={["block","flex","grid"]} onChange={(v) => setProp((p) => (p.display = v))} />
      {props.display === "flex" && <Select label="Direction" value={props.flexDirection} options={["column","row"]} onChange={(v) => setProp((p) => (p.flexDirection = v))} />}
    </div>
  );
}

// Card with two droppable regions (tutorial: CardTop/CardBottom with canMoveIn rules)
export const CardTop = ({ children }) => {
  const { connectors: { connect } } = useNode();
  return <div ref={connect} className="card-top" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>;
};
CardTop.craft = {
  displayName: "CardTop",
  props: {},
  rules: { canMoveIn: (incoming) => incoming.every((n) => n.data.type === Text || n.data.type === Heading) },
  isCanvas: true,
};
export const CardBottom = ({ children }) => {
  const { connectors: { connect } } = useNode();
  return <div ref={connect} className="card-bottom" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>;
};
CardBottom.craft = {
  displayName: "CardBottom",
  props: {},
  rules: { canMoveIn: (incoming) => incoming.every((n) => n.data.type === ButtonComp || n.data.type === InputComp) },
  isCanvas: true,
};
export const Card = ({ background, padding, children }) => {
  const { connectors: { connect, drag }, selected } = useNode((n) => ({ selected: n.events.selected }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ background: background || "#ffffff", padding: padding ?? 20, borderRadius: 8, border: selected ? "1.5px solid #4ec9b0" : "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 12, minHeight: 80 }}>
      {children}
    </div>
  );
};
Card.craft = {
  displayName: "Card",
  props: { background: "#ffffff", padding: 20 },
  related: { settings: CardSettings },
};
function CardSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Slider label="Padding" value={props.padding} min={0} max={32} onChange={(v) => setProp((p) => (p.padding = v))} />
    </div>
  );
}

export const Text = ({ text, fontSize, color, textAlign, fontWeight, lineHeight }) => {
  const { connectors: { connect, drag }, selected, hovered, actions: { setProp } } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  const [editing, setEditing] = React.useState(false);
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, borderRadius: 2 }}>
      <p
        contentEditable={editing} suppressContentEditableWarning
        onClick={() => setEditing(true)}
        onBlur={(e) => { setProp((p) => (p.text = e.target.innerText)); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}
        style={{ fontSize, color, textAlign, fontWeight, lineHeight: lineHeight || 1.5, margin: 0, outline: "none", cursor: "text" }}
      >{text}</p>
    </div>
  );
};
Text.craft = {
  displayName: "Text",
  props: { text: "Double click to edit text", fontSize: 14, color: "#1a1a1a", textAlign: "left", fontWeight: "400", lineHeight: 1.5 },
  rules: { canDrag: (node) => node.data.props.text !== "Drag" },
  related: { settings: TextSettings },
};
function TextSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Text</label><textarea value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} rows={3} style={{ ...inp, fontFamily: "Consolas, monospace", resize: "vertical" }} />
      <Slider label="Size" value={props.fontSize} min={10} max={48} onChange={(v) => setProp((p) => (p.fontSize = v))} />
      <Color label="Color" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Select label="Align" value={props.textAlign} options={["left","center","right","justify"]} onChange={(v) => setProp((p) => (p.textAlign = v))} />
      <Select label="Weight" value={props.fontWeight} options={["400","500","600","700","800"]} onChange={(v) => setProp((p) => (p.fontWeight = v))} />
    </div>
  );
}

export const Heading = ({ text, level, color, textAlign }) => {
  const { connectors: { connect, drag }, selected, hovered, actions: { setProp } } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  const Tag = `h${level}`;
  const [editing, setEditing] = React.useState(false);
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2 }}>
      <Tag
        contentEditable={editing} suppressContentEditableWarning
        onClick={() => setEditing(true)}
        onBlur={(e) => { setProp((p) => (p.text = e.target.innerText)); setEditing(false); }}
        style={{ color, textAlign, margin: 0, fontWeight: 700, outline: "none", cursor: "text", fontSize: level === 1 ? 28 : level === 2 ? 22 : 18 }}
      >{text}</Tag>
    </div>
  );
};
Heading.craft = {
  displayName: "Heading",
  props: { text: "Heading", level: 2, color: "#111", textAlign: "left" },
  related: { settings: HeadingSettings },
};
function HeadingSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Text</label><input value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} style={inp} />
      <Select label="Level" value={String(props.level)} options={["1","2","3","4"]} onChange={(v) => setProp((p) => (p.level = parseInt(v)))} />
      <Color label="Color" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Select label="Align" value={props.textAlign} options={["left","center","right"]} onChange={(v) => setProp((p) => (p.textAlign = v))} />
    </div>
  );
}

export const ButtonComp = ({ text, background, color, padding, borderRadius, width }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ display: "inline-block", border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2 }}>
      <button style={{ background, color, padding: `${padding}px ${padding * 1.6}px`, borderRadius, border: "none", cursor: "pointer", width: width || "auto", fontSize: 14, fontWeight: 600 }}>{text}</button>
    </div>
  );
};
ButtonComp.craft = {
  displayName: "Button",
  props: { text: "Button", background: "#0e639c", color: "#ffffff", padding: 10, borderRadius: 6, width: "" },
  related: { settings: ButtonSettings },
};
function ButtonSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Label</label><input value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} style={inp} />
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Color label="Text" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Slider label="Padding" value={props.padding} min={4} max={24} onChange={(v) => setProp((p) => (p.padding = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={16} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

export const InputComp = ({ placeholder, width }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, display: "inline-block", width: width || 220 }}>
      <input placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none" }} readOnly />
    </div>
  );
};
InputComp.craft = { displayName: "Input", props: { placeholder: "Enter text…", width: 220 }, related: { settings: InputSettings } };
function InputSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Placeholder</label><input value={props.placeholder} onChange={(e) => setProp((p) => (p.placeholder = e.target.value))} style={inp} />
      <Slider label="Width" value={props.width} min={120} max={400} onChange={(v) => setProp((p) => (p.width = v))} />
    </div>
  );
}

export const ImageComp = ({ src, width, height, borderRadius }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, display: "inline-block" }}>
      <img src={src} alt="" style={{ width, height, borderRadius, objectFit: "cover", display: "block", background: "#f3f4f6" }} />
    </div>
  );
};
ImageComp.craft = { displayName: "Image", props: { src: "https://via.placeholder.com/320x180?text=Image", width: 320, height: 180, borderRadius: 8 }, related: { settings: ImageSettings } };
function ImageSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Src</label><input value={props.src} onChange={(e) => setProp((p) => (p.src = e.target.value))} style={inp} />
      <Slider label="Width" value={props.width} min={80} max={600} onChange={(v) => setProp((p) => (p.width = v))} />
      <Slider label="Height" value={props.height} min={60} max={400} onChange={(v) => setProp((p) => (p.height = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

export const BoxComp = ({ background, width, height, borderRadius }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return <div ref={(ref) => connect(drag(ref))} style={{ width, height, background, borderRadius, border: selected ? "1.5px solid #4ec9b0" : hovered ? "1px dashed #569cd6" : "1px solid #e5e7eb" }} />;
};
BoxComp.craft = { displayName: "Box", props: { background: "#e0e7ff", width: 100, height: 100, borderRadius: 8 }, related: { settings: BoxSettings } };
function BoxSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Slider label="Width" value={props.width} min={40} max={400} onChange={(v) => setProp((p) => (p.width = v))} />
      <Slider label="Height" value={props.height} min={40} max={400} onChange={(v) => setProp((p) => (p.height = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

export const DividerComp = () => {
  const { connectors: { connect, drag }, selected } = useNode((n) => ({ selected: n.events.selected }));
  return <div ref={(ref) => connect(drag(ref))} style={{ borderTop: selected ? "2px solid #4ec9b0" : "1px solid #e5e7eb", margin: "8px 0", height: 1 }} />;
};
DividerComp.craft = { displayName: "Divider", props: {}, related: { settings: () => <div style={{ fontSize: 11, color: "#888" }}>Divider — no props</div> } };

// ── Toolbox (uses connectors.create per Craft.js docs) ────────────────────────
const Toolbox = () => {
  const { connectors } = useEditor();
  const items = [
    { icon: ContainerIcon, label: "Container", comp: <Element is={Container} canvas background="#ffffff" padding={16} /> },
    { icon: Heading1, label: "Heading", comp: <Heading text="Heading" level={2} /> },
    { icon: Type, label: "Text", comp: <Text text="Sample text — drag to canvas" /> },
    { icon: MousePointerClick, label: "Button", comp: <ButtonComp text="Click me" /> },
    { icon: TextCursorInput, label: "Input", comp: <InputComp /> },
    { icon: ImageIcon, label: "Image", comp: <ImageComp /> },
    { icon: Square, label: "Shape", comp: <BoxComp /> },
    { icon: Minus, label: "Divider", comp: <DividerComp /> },
    { icon: Box, label: "Card", comp: <Card><Element id="card-top" is={CardTop} canvas><Text text="Title" fontSize={18} /><Text text="Subtitle" fontSize={13} /></Element><Element id="card-bottom" is={CardBottom} canvas><ButtonComp text="Action" /></Element></Card> },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {items.map((it) => (
        <div
          key={it.label}
          ref={(ref) => connectors.create(ref, it.comp)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: "10px 6px", background: "#2d2d2d", border: "1px solid #3a3a3a", borderRadius: 6,
            cursor: "grab", color: "#ccc", fontSize: 11, fontWeight: 500,
          }}
          title={`Drag ${it.label} to canvas — then edit via Properties`}
        >
          <it.icon size={16} style={{ color: "#4ec9b0" }} />
          {it.label}
        </div>
      ))}
    </div>
  );
};

// ── Settings Panel (shows selected node's related.settings) ───────────────────
const SettingsPanel = () => {
  const { selected, query, actions } = useEditor((state, query) => {
    const [id] = state.events.selected;
    let selected;
    if (id) selected = state.nodes[id];
    return { selected, query };
  });
  const selectedId = useEditor((state) => state.events.selected.values().next().value);
  if (!selected) return <div style={{ padding: 12, color: "#666", fontSize: 11, textAlign: "center" }}>Select an element to edit<br/>props & styles</div>;
  const related = selected.related?.settings;
  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2d2d2d", paddingBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 6 }}><Settings2 size={12} /> {selected.data.displayName || selected.data.name}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => selectedId && actions.delete(selectedId)}
            title="Delete (only if deletable)"
            style={{ background: "#3a1d1d", border: "1px solid #5a2a2a", color: "#f48771", borderRadius: 4, padding: "4px 6px", cursor: "pointer", display: "flex" }}
          ><Trash2 size={12} /></button>
          <button
            onClick={() => {
              if (!selectedId) return;
              const node = query.node(selectedId).get();
              const newNode = query.parseFreshNode({ data: { ...node.data, displayName: node.data.displayName } });
              // Craft.js copy helper — create fresh node from serialized data
              try { actions.addNodeTree(query.parseFreshNode({ data: node.data }), node.data.parent); } catch {}
            }}
            title="Duplicate (via query)"
            style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", borderRadius: 4, padding: "4px 6px", cursor: "pointer", display: "flex" }}
          ><Copy size={12} /></button>
        </div>
      </div>
      {related && React.createElement(related)}
      <div style={{ fontSize: 10, color: "#555", borderTop: "1px solid #2d2d2d", paddingTop: 8, lineHeight: 1.5 }}>
        Drag to move • Drop inside Container/Card to nest • Double-click Text/Heading to edit inline
      </div>
    </div>
  );
};

// ── Topbar (enable toggle + serialize + history) ──────────────────────────────
const Topbar = () => {
  const { actions, query, enabled, canUndo, canRedo } = useEditor((state, query) => ({
    enabled: state.options.enabled,
    canUndo: query.history.canUndo(),
    canRedo: query.history.canRedo(),
  }));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#252526", borderBottom: "1px solid #2d2d2d" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#bbb", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => actions.setOptions((o) => (o.enabled = e.target.checked))} style={{ accentColor: "#4ec9b0" }} />
        Enable editing
      </label>
      <div style={{ width: 1, height: 16, background: "#333" }} />
      <button disabled={!canUndo} onClick={() => actions.history.undo()} title="Undo" style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: canUndo ? "#ccc" : "#555", borderRadius: 4, padding: "4px 6px", cursor: canUndo ? "pointer" : "default", display: "flex" }}><Undo2 size={12}/></button>
      <button disabled={!canRedo} onClick={() => actions.history.redo()} title="Redo" style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: canRedo ? "#ccc" : "#555", borderRadius: 4, padding: "4px 6px", cursor: canRedo ? "pointer" : "default", display: "flex" }}><Redo2 size={12}/></button>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => {
          const json = query.serialize();
          console.log(json);
          navigator.clipboard.writeText(json).then(() => {}).catch(()=>{});
          try { window.electronAPI?.clipboardWrite?.(json); } catch {}
        }}
        title="Serialize JSON to console + clipboard"
        style={{ background: "#0e639c", border: "1px solid #0e639c", color: "#fff", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
      ><Code2 size={12}/> Serialize</button>
    </div>
  );
};

// ── Builder Canvas (Frame with droppable root) ────────────────────────────────
const BuilderCanvas = () => {
  return (
    <div style={{ minHeight: "100%", padding: 2 }}>
      <Frame>
        <Element is={Container} canvas background="#ffffff" padding={24} gap={16}>
          <Heading text="Visual Builder — Craft.js" level={1} color="#111" textAlign="left" />
          <Text text="Drag elements from the left palette. Select to edit on the right. Nest inside Containers/Cards. Supports JSX/TSX/HTML export." fontSize={13} color="#555" />
          <Container background="#f9fafb" padding={16} gap={12} display="flex" flexDirection="row">
            <ButtonComp text="Primary" />
            <ButtonComp text="Secondary" background="#2d2d2d" />
            <InputComp placeholder="Type here…" />
          </Container>
          <Card background="#ffffff" padding={16}>
            <Element id="card-top" is={CardTop} canvas>
              <Text text="Card Title" fontSize={18} />
              <Text text="Card subtitle — only Text/Heading allowed here" fontSize={12} color="#666" />
            </Element>
            <Element id="card-bottom" is={CardBottom} canvas>
              <ButtonComp text="Action" />
            </Element>
          </Card>
        </Element>
      </Frame>
    </div>
  );
};

// ── Main Builder Panel — wraps Editor, handles files (JSX/TSX/HTML) ──────────
const BuilderPanel = () => {
  const { dialog, ask } = useInputDialog();
  const [projectFiles, setProjectFiles] = useState([]);
  const [filePath, setFilePath] = useState(null);
  const [code, setCode] = useState("");
  const [original, setOriginal] = useState("");
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useState("visual"); // visual | code
  const [status, setStatus] = useState(null);

  const scanFiles = useCallback(async () => {
    const root = window.__currentProjectPath;
    if (!root) { setProjectFiles([]); return; }
    const walk = async (dir, depth = 0) => {
      if (depth > 6) return [];
      let out = [];
      try {
        const entries = await window.electronAPI.readDirAll(dir);
        for (const e of entries) {
          if (e.name.startsWith(".") || ["node_modules","dist","build",".git","out",".next","coverage"].includes(e.name)) continue;
          if (e.isDir) { const sub = await walk(e.path, depth + 1); out = out.concat(sub); if (out.length > 500) break; }
          else if (/\.(jsx|tsx|html|htm)$/i.test(e.name)) out.push(e.path);
        }
      } catch {}
      return out;
    };
    const files = (await walk(root)).slice(0, 500);
    setProjectFiles(files);
    if (!filePath && files.length) setFilePath(files[0]);
  }, []);

  useEffect(() => { scanFiles(); }, [scanFiles]);
  useEffect(() => {
    const onOpen = () => scanFiles();
    const onClose = () => { setProjectFiles([]); setFilePath(null); setCode(""); setOriginal(""); };
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => { window.removeEventListener("project:opened", onOpen); window.removeEventListener("project:closed", onClose); };
  }, [scanFiles]);

  const loadFile = useCallback(async (path) => {
    if (!path) return;
    try {
      const text = await window.electronAPI.readTextFile(path);
      if (text !== null) { setCode(text); setOriginal(text); setStatus(null); }
    } catch {}
  }, []);
  useEffect(() => { if (filePath) loadFile(filePath); else { setCode(""); setOriginal(""); } }, [filePath, loadFile]);

  const doSave = useCallback(async () => {
    if (!filePath) return;
    try {
      const res = await window.electronAPI.writeFileText(filePath, code);
      if (res?.success) { setOriginal(code); setStatus("Saved ✓"); setTimeout(()=>setStatus(null),1500); }
      else setStatus("Save failed");
    } catch { setStatus("Save failed"); }
  }, [filePath, code]);

  const isDirty = code !== original;

  const handleNew = useCallback(async (type) => {
    const root = window.__currentProjectPath;
    if (!root) { setStatus("Open a project first"); return; }
    const suggested = type === "html" ? "NewPage.html" : type === "tsx" ? "MyComponent.tsx" : "MyComponent.jsx";
    const name = await ask(`New ${type.toUpperCase()} file:`, suggested);
    if (!name) return;
    let finalName = name.trim();
    if (!/\.(jsx|tsx|html|htm)$/i.test(finalName)) finalName += type === "html" ? ".html" : type === "tsx" ? ".tsx" : ".jsx";
    const tmpl = type === "html"
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;padding:24px}h1{color:#0e639c}</style></head><body><h1>Hello HTML</h1><p>Built with Craft.js Builder</p></body></html>`
      : `export default function MyComponent(){\n  return (\n    <div style={{padding:24}}>\n      <h1>Hello ${type.toUpperCase()}</h1>\n    </div>\n  );\n}`;
    try {
      const created = await window.electronAPI.newFile(root, finalName);
      const target = created || (root.replace(/\\/g,"/") + "/" + finalName);
      await window.electronAPI.writeFileText(target, tmpl);
      await scanFiles();
      setFilePath(target);
      setStatus(`Created ${finalName}`);
    } catch (e) { setStatus(e?.message || "Create failed"); }
  }, [ask, scanFiles]);

  const filteredFiles = useMemo(() => {
    let list = projectFiles;
    if (typeFilter !== "all") {
      list = list.filter((p) => {
        const e = p.slice(p.lastIndexOf(".")).toLowerCase();
        if (typeFilter === "jsx") return e === ".jsx" || e === ".js";
        if (typeFilter === "tsx") return e === ".tsx" || e === ".ts";
        if (typeFilter === "html") return e === ".html" || e === ".htm";
        return true;
      });
    }
    const q = filter.trim().toLowerCase();
    if (q) list = list.filter((p) => p.split(/[\\/]/).pop().toLowerCase().includes(q) || p.toLowerCase().includes(q));
    return list;
  }, [projectFiles, filter, typeFilter]);

  const viewBtn = (mode, Icon, label) => (
    <button onClick={() => setViewMode(mode)} title={label} style={{ display: "flex", alignItems: "center", gap: 4, background: viewMode === mode ? "#333" : "transparent", color: viewMode === mode ? "#fff" : "#aaa", border: "1px solid " + (viewMode === mode ? "#444" : "transparent"), borderRadius: 3, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}><Icon size={12}/>{label}</button>
  );

  if (!window.__currentProjectPath) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#181818", color: "#666", flexDirection: "column", gap: 10 }}>
        <Palette size={28} style={{ opacity: 0.5 }} />
        <div style={{ fontWeight: 600 }}>No project open</div>
        <div style={{ fontSize: 12, color: "#555" }}>Open a folder to use Visual Builder (Craft.js)</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#ccc", overflow: "hidden" }}>
      {dialog}
      <Editor
        resolver={{ Container, Text, Heading, Button: ButtonComp, Input: InputComp, Image: ImageComp, Box: BoxComp, Divider: DividerComp, Card, CardTop, CardBottom }}
        enabled={true}
        indicator={{ success: "#4ec9b0", error: "#f44747" }}
      >
        {/* File + Type Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#bbb", display: "flex", alignItems: "center", gap: 6 }}>
            <Palette size={14} style={{ color: "#4ec9b0" }} /> Builder
            <span style={{ fontSize: 10, color: "#666", fontWeight: 400, textTransform: "none" }}>— Craft.js • JSX / TSX / HTML</span>
          </span>
          <div style={{ width: 1, height: 14, background: "#333" }} />
          <select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)} style={{ background: "#1e1e1e", color: "#ccc", border: "1px solid #3a3a3a", borderRadius: 3, fontSize: 11, padding: "3px 6px" }}>
            <option value="all">All</option><option value="jsx">JSX</option><option value="tsx">TSX</option><option value="html">HTML</option>
          </select>
          <div style={{ position: "relative", flex: "0 0 120px" }}>
            <Search size={12} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", color: "#666" }} />
            <input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="Filter" style={{ width: "100%", background: "#1e1e1e", border: "1px solid #3a3a3a", borderRadius: 3, color: "#ddd", fontSize: 11, padding: "4px 6px 4px 22px", outline: "none" }} />
          </div>
          <select value={filePath || ""} onChange={(e)=>setFilePath(e.target.value||null)} style={{ flex: 1, minWidth: 140, maxWidth: 220, background: "#1e1e1e", color: "#ddd", border: "1px solid #3a3a3a", borderRadius: 3, fontSize: 11, padding: "4px 6px" }}>
            {filteredFiles.length===0 ? <option value="">{projectFiles.length? "No match":"No files"}</option> : filteredFiles.map((p)=><option key={p} value={p}>{p.split(/[\\/]/).pop()} — {p.replace(window.__currentProjectPath?.replace(/\\/g,"/")+"/","")}</option>)}
          </select>
          {filePath && <span style={{ fontSize: 10, color: isDirty ? "#e6a23c" : "#4ec9b0" }}>{isDirty ? "● Modified" : "● Saved"}</span>}
        </div>

        {/* Actions + View Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "#1e1e1e", borderBottom: "1px solid #2d2d2d", flexWrap: "wrap" }}>
          <button onClick={()=>handleNew("jsx")} style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><FilePlus size={12}/> JSX</button>
          <button onClick={()=>handleNew("tsx")} style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><FileCode size={12}/> TSX</button>
          <button onClick={()=>handleNew("html")} style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><FileText size={12}/> HTML</button>
          <div style={{ width: 1, height: 16, background: "#333", margin: "0 4px" }} />
          <button onClick={doSave} disabled={!isDirty} style={{ background: isDirty ? "#0e639c" : "#2d2d2d", color: isDirty ? "#fff" : "#777", border: "1px solid " + (isDirty ? "#0e639c" : "#3a3a3a"), borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: isDirty ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4 }}><Save size={12}/> Save</button>
          {status && <span style={{ fontSize: 11, color: "#4ec9b0" }}>{status}</span>}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 4, background: "#252526", borderRadius: 4, padding: 2, border: "1px solid #333" }}>
            {viewBtn("visual", Eye, "Visual")}
            {viewBtn("code", Code2, "Code")}
          </div>
        </div>

        <Topbar />

        {viewMode === "code" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 8, gap: 8, background: "#1e1e1e" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#1e1e1e", border: "1px solid #2d2d2d", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ padding: "6px 8px", fontSize: 10, color: "#888", background: "#252526", borderBottom: "1px solid #2d2d2d", display: "flex", justifyContent: "space-between" }}>
                <span>{filePath ? filePath.split(/[\\/]/).pop() : "No file"}</span><span>{filePath ? filePath.slice(filePath.lastIndexOf(".")).toUpperCase() : ""}</span>
              </div>
              <textarea value={code} onChange={(e)=>setCode(e.target.value)} placeholder={filePath ? "Start coding…" : "Select or create a JSX / TSX / HTML file"} spellCheck={false} style={{ flex: 1, width: "100%", background: "#1e1e1e", color: "#d4d4d4", border: "none", outline: "none", padding: 12, fontSize: 12, fontFamily: "Consolas, monospace", resize: "none", lineHeight: 1.5 }} />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
            <div style={{ width: 160, background: "#252526", borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "8px 8px 4px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}><Box size={10}/> Elements</div>
              <div style={{ padding: 8, overflowY: "auto", flex: 1 }}><Toolbox /></div>
              <div style={{ padding: 8, borderTop: "1px solid #2d2d2d", fontSize: 10, color: "#555", lineHeight: 1.4 }}>Drag to canvas • Nest in Container/Card • Double-click text to edit</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#181818", overflow: "hidden", minWidth: 0 }}>
              <div style={{ flex: 1, overflow: "auto", padding: 12, background: "repeating-conic-gradient(#1e1e1e 0% 25%, #252526 0% 50%) 50% / 24px 24px" }}>
                <div style={{ minHeight: 400, background: "#fff", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.45)", overflow: "hidden", maxWidth: 960, margin: "0 auto" }}>
                  <BuilderCanvas />
                </div>
              </div>
            </div>
            <div style={{ width: 260, background: "#252526", borderLeft: "1px solid #2d2d2d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", borderBottom: "1px solid #2d2d2d" }}>
                <div style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6, background: "#2d2d2d" }}><Settings2 size={10}/> Properties</div>
                <SettingsPanel />
              </div>
              <div style={{ height: 180, overflowY: "auto" }}>
                <div style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6, background: "#2d2d2d", borderBottom: "1px solid #2d2d2d" }}><Layers size={10}/> Layers</div>
                <div style={{ padding: 4 }}>
                  <CraftLayers expandRootOnLoad />
                </div>
              </div>
            </div>
          </div>
        )}
      </Editor>
    </div>
  );
};

export default BuilderPanel;
