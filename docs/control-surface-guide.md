# Writing an Ableton Control Surface for Intech EN16

A practical guide to building a control surface script using Ableton's `ableton.v3` framework.

## Hardware Overview

The Intech EN16 is a grid controller with:
- 16 endless encoders (sending MIDI CC)
- 16 buttons under encoders (sending MIDI Note on press)
- 16 "long press" button events (separate MIDI Notes)
- 1 control button

### MIDI Layout

| Control | Type | Channel | Identifiers |
|---------|------|---------|-------------|
| Encoders | CC | 0 | 32-47 |
| Buttons | Note | 0 | 32-47 |
| Long Buttons | Note | 0 | 48-63 |
| Control Button | Note | 0 | 64 |

## Project Structure

```
Intech/
├── __init__.py              # Entry point + specification
├── elements.py              # MIDI control definitions
├── mappings.py              # Control → component wiring
├── session.py               # Custom session behavior
└── target_track_controls.py # Selected track parameters
```

## Step 1: Define Capabilities (`__init__.py`)

Every control surface needs a `get_capabilities()` function that tells Live what MIDI ports the script uses:

```python
from ableton.v3.control_surface.capabilities import (
    NOTES_CC,
    PORTS_KEY,
    SCRIPT,
    inport,
    outport,
)

def get_capabilities():
    return {
        PORTS_KEY: [
            inport(props=[NOTES_CC, SCRIPT]),   # Receives notes and CCs
            outport(props=[NOTES_CC, SCRIPT]),  # Sends notes and CCs
        ]
    }
```

Capability flags:
- `NOTES_CC` - Port handles note and CC messages
- `SCRIPT` - Port is used by this script (not passed to tracks)
- `REMOTE` - Port can be used for MIDI remote control

## Step 2: Define Elements (`elements.py`)

Elements represent physical controls. Import `ElementsBase` from `ableton.v3.control_surface`:

```python
from ableton.v3.control_surface import ElementsBase, MIDI_CC_TYPE, MIDI_NOTE_TYPE

NUM_TRACKS = 8
NUM_SCENES = 4


class Elements(ElementsBase):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)

        # 16 encoders as a single row
        self.add_encoder_matrix(
            [list(range(32, 48))],
            "Encoders",
            msg_type=MIDI_CC_TYPE,
        )

        # Device parameter encoders (first 8)
        self.add_encoder_matrix(
            [list(range(32, 40))],
            "Device_Encoders",
            msg_type=MIDI_CC_TYPE,
        )

        # Track select buttons
        self.add_button_matrix(
            [list(range(32, 40))],
            "Track_Select_Buttons",
            msg_type=MIDI_NOTE_TYPE,
        )

        # Single button
        self.add_button(
            64,
            "Control_Button",
            msg_type=MIDI_NOTE_TYPE,
        )
```

### Element Naming Convention

The framework auto-generates element references based on the name you provide:

| Method Call | Generated Attributes |
|-------------|---------------------|
| `add_encoder_matrix(..., "Encoders")` | `encoders`, `encoders_raw` |
| `add_button_matrix(..., "Track_Select_Buttons")` | `track_select_buttons`, `track_select_buttons_raw` |
| `add_button(..., "Control_Button")` | `control_button` |

**Important**: There is NO automatic `_row_0`, `_row_1` naming. To reference specific elements:
- Use `"encoders_raw[0]"` for the first encoder
- Use `"encoders_raw[0:8]"` for a slice
- Create separate named matrices for different groups

### Session Matrix Layout

For clip launching, the matrix must be organized as **rows = scenes**, **columns = tracks**:

```python
# 4 scenes × 1 track
self.add_button_matrix(
    [[44], [45], [46], [47]],  # Each row is a scene
    "Clip_Launch_Buttons",
    msg_type=MIDI_NOTE_TYPE,
)
```

## Step 3: Create Mappings (`mappings.py`)

Mappings connect elements to components:

```python
def create_mappings(control_surface):
    mappings = {}

    # Device: encoders control device parameters
    mappings["Device"] = dict(
        parameter_controls="device_encoders",
    )

    # Mixer: track selection and arm
    mappings["Mixer"] = dict(
        track_select_buttons="track_select_buttons",
        arm_buttons="arm_buttons",
    )

    # Session: clip launching
    mappings["Session"] = dict(
        clip_launch_buttons="clip_launch_buttons",
    )

    # Custom component with individual encoder references
    mappings["Target_Track_Controls"] = dict(
        volume_control="encoders_raw[15]",
        send_a_control="encoders_raw[14]",
    )

    return mappings
```

### Built-in Components

The framework provides these components automatically:

| Component | Purpose | Common Mappings |
|-----------|---------|-----------------|
| `Device` | Control device parameters | `parameter_controls`, `prev_button`, `next_button` |
| `Device_Navigation` | Navigate device chain | `prev_button`, `next_button` |
| `Mixer` | Track mixing | `volume_controls`, `pan_controls`, `send_controls`, `arm_buttons`, `solo_buttons`, `mute_buttons`, `track_select_buttons` |
| `Session` | Clip launching | `clip_launch_buttons`, `scene_launch_buttons`, `stop_track_clip_buttons` |
| `Session_Navigation` | Move session view | `up_button`, `down_button`, `left_button`, `right_button` |
| `Transport` | Playback control | `play_button`, `stop_button`, `record_button`, `loop_button` |
| `Target_Track` | Track selection provider | (no direct mappings, provides dependency) |
| `View_Based_Recording` | Recording follows view | (no direct mappings) |

## Step 4: Create Specification (`__init__.py`)

The specification ties everything together:

```python
from ableton.v3.control_surface import ControlSurface, ControlSurfaceSpecification

from .elements import NUM_SCENES, NUM_TRACKS, Elements
from .mappings import create_mappings
from .session import SessionComponent

class Specification(ControlSurfaceSpecification):
    elements_type = Elements
    num_tracks = NUM_TRACKS
    num_scenes = NUM_SCENES
    create_mappings_function = create_mappings

    # Override built-in components with custom ones
    component_map = {
        "Session": SessionComponent,
    }

    # Mixer configuration
    include_returns = True
    include_master = False

class Grid(ControlSurface):
    def __init__(self, *a, **k):
        super().__init__(*a, specification=Specification, **k)
```

### Specification Options

| Option | Type | Description |
|--------|------|-------------|
| `elements_type` | class | Your `Elements` subclass |
| `create_mappings_function` | callable | Function returning mappings dict |
| `component_map` | dict | Override component types |
| `num_tracks` | int | Number of tracks for mixer/session |
| `num_scenes` | int | Number of scenes for session |
| `include_returns` | bool | Include return tracks in mixer |
| `include_master` | bool | Include master track in mixer |
| `identity_response_id_bytes` | tuple | SysEx ID for device identification |

## Step 5: Custom Components

### Custom Session (Toggle Clip Playback)

Override component behavior by subclassing:

```python
from ableton.v3.control_surface.components import (
    ClipSlotComponent as ClipSlotComponentBase,
    SceneComponent as SceneComponentBase,
    SessionComponent as SessionComponentBase,
)
from ableton.v3.live import liveobj_valid


class ClipSlotComponent(ClipSlotComponentBase):
    """Stop playing clips instead of retriggering."""

    def _do_launch_slot(self):
        clip_slot = self._clip_slot
        if liveobj_valid(clip_slot) and clip_slot.has_clip:
            if clip_slot.clip.is_playing:
                clip_slot.stop()
                return
        super()._do_launch_slot()


class SceneComponent(SceneComponentBase):
    clip_slot_component_type = ClipSlotComponent


class SessionComponent(SessionComponentBase):
    scene_component_type = SceneComponent
```

Register in specification:
```python
component_map = {
    "Session": SessionComponent,
}
```

### Custom Component with Dependency Injection

Create components that react to Live's state:

```python
import logging

from ableton.v3.base import depends, listens
from ableton.v3.control_surface import Component
from ableton.v3.control_surface.controls import MappedControl

logger = logging.getLogger(__name__)


class TargetTrackControlsComponent(Component):
    """Map encoders to the currently selected track's volume and sends."""

    volume_control = MappedControl()
    send_a_control = MappedControl()
    send_b_control = MappedControl()
    send_c_control = MappedControl()

    @depends(target_track=None)
    def __init__(self, *a, target_track=None, **k):
        super().__init__(*a, **k)
        self._target_track_provider = target_track
        # Connect listener (note the name mangling for private listener)
        self._TargetTrackControlsComponent__on_target_track_changed.subject = (
            target_track
        )
        self._update_controls()

    @listens("target_track")
    def __on_target_track_changed(self):
        self._update_controls()

    def _update_controls(self):
        track = (
            self._target_track_provider.target_track
            if self._target_track_provider
            else None
        )
        if track:
            logger.info("Target track changed: %s", track.name)
            mixer = track.mixer_device
            sends = list(mixer.sends)
            self.volume_control.mapped_parameter = mixer.volume
            self.send_a_control.mapped_parameter = sends[0] if len(sends) > 0 else None
            self.send_b_control.mapped_parameter = sends[1] if len(sends) > 1 else None
            self.send_c_control.mapped_parameter = sends[2] if len(sends) > 2 else None
        else:
            self.volume_control.mapped_parameter = None
            self.send_a_control.mapped_parameter = None
            self.send_b_control.mapped_parameter = None
            self.send_c_control.mapped_parameter = None
```

Map it:
```python
mappings["Target_Track_Controls"] = dict(
    volume_control="encoders_raw[15]",
    send_a_control="encoders_raw[14]",
    send_b_control="encoders_raw[13]",
    send_c_control="encoders_raw[12]",
)
```

### Key Patterns

**`@depends`** - Inject dependencies provided by the framework:
```python
@depends(target_track=None, song=None, show_message=None)
def __init__(self, *a, target_track=None, song=None, show_message=None, **k):
```

Available dependencies:
- `target_track` - Currently selected track provider
- `song` - Live's Song object
- `show_message` - Display message in Live's status bar

**`@listens`** - Declare reactive listeners:
```python
@listens("target_track")
def __on_target_track_changed(self):
    # Called when selected track changes
```

**`MappedControl`** - Auto-connecting parameter control:
```python
volume_control = MappedControl()
# Then in code:
self.volume_control.mapped_parameter = track.mixer_device.volume
```

**`ButtonControl`** - Reactive button handling:
```python
from ableton.v3.control_surface.controls import ButtonControl

class MyComponent(Component):
    my_button = ButtonControl()

    @my_button.pressed
    def my_button(self, button):
        self.song.tempo += 1
```

## Import Reference

Common imports for v3 control surfaces:

```python
# Core
from ableton.v3.control_surface import (
    ControlSurface,
    ControlSurfaceSpecification,
    Component,
    ElementsBase,
    MIDI_CC_TYPE,
    MIDI_NOTE_TYPE,
)

# Capabilities
from ableton.v3.control_surface.capabilities import (
    NOTES_CC, PORTS_KEY, SCRIPT, REMOTE,
    inport, outport,
)

# Components
from ableton.v3.control_surface.components import (
    ClipSlotComponent,
    DeviceComponent,
    MixerComponent,
    SceneComponent,
    SessionComponent,
    TransportComponent,
)

# Controls
from ableton.v3.control_surface.controls import (
    ButtonControl,
    MappedControl,
)

# Base utilities
from ableton.v3.base import depends, listens

# Live object utilities
from ableton.v3.live import liveobj_valid
```

## Debugging

### Enable Logging

Add to your component:
```python
import logging
logger = logging.getLogger(__name__)

logger.info("Something happened")
logger.warning("This might be a problem")
logger.error("This is definitely a problem")
```

Logs appear in:
- macOS: `~/Library/Preferences/Ableton/Live x.x.x/Log.txt`
- Windows: `%APPDATA%\Ableton\Live x.x.x\Preferences\Log.txt`

### Show Messages in Live

```python
@depends(show_message=None)
def __init__(self, *a, show_message=None, **k):
    super().__init__(*a, **k)
    self._show_message = show_message

def some_method(self):
    self._show_message("Hello from the script!")
```

### Clear Python Cache

After editing files, clear the cache before reloading:
```bash
rm -rf __pycache__
```

Then reload via Preferences or Tools → Reload MIDI Remote Scripts.

## References

- [NK2Reshift](https://github.com/kmontag/NK2Reshift) - Well-documented v3 example
- [ableton-control-surface-toolkit](https://github.com/oslo1989/ableton-control-surface-toolkit) - Live object documentation
- Ableton's built-in scripts: `/Applications/Ableton Live.app/Contents/App-Resources/MIDI Remote Scripts/`
- `ableton.v3` source: `MIDI Remote Scripts/ableton/v3/`
