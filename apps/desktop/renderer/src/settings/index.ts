/// <reference types="vite/client" />

/**
 * Settings window entry. Independent of the main pet window — no Pixi/Live2D
 * here. Renders the Cirrus-styled shell and wires each panel (model, size,
 * input actions, archive, AI). Panel logic lives in `./panels/*`; shared UI
 * helpers (toast, slider, escape) in `./ui`; the shell markup in `./shell`.
 */

import '../styles/settings.css';
import { renderShell } from './shell';
import { wireArchive } from './panels/archive';
import { wireAiToggle } from './panels/ai';
import { wireInputActions } from './panels/input-actions';
import { wireModelPanel } from './panels/model';
import { wireSize } from './panels/size';

renderShell();
wireModelPanel();
void wireSize();
void wireInputActions();
void wireArchive();
wireAiToggle();
