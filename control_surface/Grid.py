"""
Ableton control surface for Intech EN16 Grid controller.

Hardware layout:
- 16 encoders (CC 32-47): first 8 for device, last 4 for selected track
- 16 buttons (Note 32-47): first 8 for track select, next 4 for return select, last 4 for clips
- 16 long-press buttons (Note 48-63): first 8 for track arm
- 1 control button (Note 64): refresh surface
"""

import logging

import Live
from _Framework.ButtonElement import ButtonElement
from _Framework.ButtonMatrixElement import ButtonMatrixElement
from _Framework.ClipSlotComponent import ClipSlotComponent
from _Framework.ControlSurface import ControlSurface
from _Framework.DeviceComponent import DeviceComponent
from _Framework.EncoderElement import EncoderElement
from _Framework.InputControlElement import MIDI_CC_TYPE, MIDI_NOTE_TYPE
from _Framework.MixerComponent import MixerComponent
from _Framework.SceneComponent import SceneComponent
from _Framework.SessionComponent import SessionComponent

logger = logging.getLogger(__name__)

# MIDI configuration
CHANNEL = 0
ENCODER_CC_START = 32
BUTTON_NOTE_START = 32
LONG_BUTTON_NOTE_START = 48
CONTROL_BUTTON_NOTE = 64

# Layout configuration
NUM_ENCODERS = 16
NUM_TRACKS = 8
NUM_RETURNS = 4
NUM_SCENES = 4
NUM_TRACK_PARAMS = 4  # volume + 3 sends


class EncoderLayout:
    """Named slices for encoder groups."""

    DEVICE = slice(0, NUM_TRACKS)
    TRACK = slice(NUM_ENCODERS - NUM_TRACK_PARAMS, NUM_ENCODERS)


class ButtonLayout:
    """Named slices for button groups."""

    TRACK_SELECT = slice(0, NUM_TRACKS)
    RETURN_SELECT = slice(NUM_TRACKS, NUM_TRACKS + NUM_RETURNS)
    CLIP_LAUNCH = slice(NUM_TRACKS + NUM_RETURNS, NUM_TRACKS + NUM_RETURNS + NUM_SCENES)


def make_encoder(identifier, name):
    return EncoderElement(MIDI_CC_TYPE, CHANNEL, identifier, map_mode=Live.MidiMap.MapMode.absolute, name=name)


def make_button(identifier, name):
    return ButtonElement(True, MIDI_NOTE_TYPE, CHANNEL, identifier, name=name)


def make_controls(maker, label, identifiers):
    return [maker(ident, label % i) for i, ident in enumerate(identifiers)]


class ToggleClipSlotComponent(ClipSlotComponent):
    """Clip slot that stops playing clips instead of retriggering."""

    def _do_launch_clip(self, fire_state):
        slot = self._clip_slot
        if slot and slot.has_clip:
            clip = slot.clip
            if clip.is_playing or clip.is_triggered:
                slot.stop()
                return
        super()._do_launch_clip(fire_state)


class ToggleSceneComponent(SceneComponent):
    clip_slot_component_type = ToggleClipSlotComponent


class ToggleSessionComponent(SessionComponent):
    scene_component_type = ToggleSceneComponent


class Grid(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        with self.component_guard():
            self._create_controls()
            self._setup_device()
            self._setup_mixer()
            self._setup_session()
            self._set_track_controls(self.song().view.selected_track)

    def disconnect(self):
        self._control_button.remove_value_listener(self._on_control)
        super().disconnect()

    def _create_controls(self):
        encoder_ccs = range(ENCODER_CC_START, ENCODER_CC_START + NUM_ENCODERS)
        button_notes = range(BUTTON_NOTE_START, BUTTON_NOTE_START + NUM_ENCODERS)
        long_button_notes = range(LONG_BUTTON_NOTE_START, LONG_BUTTON_NOTE_START + NUM_ENCODERS)

        self._encoders = make_controls(make_encoder, "Encoder_%d", encoder_ccs)
        self._buttons = make_controls(make_button, "Button_%d", button_notes)
        self._long_buttons = make_controls(make_button, "Long_Button_%d", long_button_notes)

        self._control_button = make_button(CONTROL_BUTTON_NOTE, "Control")
        self._control_button.add_value_listener(self._on_control)

    def _on_control(self, value):
        if value:
            logger.info("Control button pressed, updating surface")
            self.update()

    def _setup_device(self):
        device_controls = tuple(self._encoders[EncoderLayout.DEVICE])
        device = DeviceComponent()
        device.set_parameter_controls(device_controls)
        self.set_device_component(device)

    def _on_selected_track_changed(self):
        super()._on_selected_track_changed()
        track = self.song().view.selected_track
        if not track:
            return

        logger.info("Selected track changed: %s", track.name)
        self._update_device_for_track(track)
        self._set_track_controls(track)
        self._update_session_offset(track)

    def _update_device_for_track(self, track):
        if not self._device_component:
            return
        device = track.view.selected_device
        if not device and track.devices:
            device = track.devices[0]
            self.song().view.select_device(device)
        self._device_component.set_device(device)

    def _update_session_offset(self, track):
        tracks = list(self.song().tracks)
        if track in tracks:
            self._session.set_offsets(tracks.index(track), self._session.scene_offset())

    def _setup_session(self):
        self._session = ToggleSessionComponent(num_tracks=1, num_scenes=NUM_SCENES)
        self._session.set_offsets(0, 0)
        clip_buttons = self._buttons[ButtonLayout.CLIP_LAUNCH]
        matrix = ButtonMatrixElement(rows=[[b] for b in clip_buttons])
        self._session.set_clip_launch_buttons(matrix)

    def _is_armable_track(self, track):
        """Check if track is a regular track (not master or return)."""
        if not track:
            return False
        if track == self.song().master_track:
            return False
        if track in self.song().return_tracks:
            return False
        return True

    def _set_track_controls(self, track):
        track_encoders = self._encoders[EncoderLayout.TRACK]

        # Always release all track encoders first
        for encoder in track_encoders:
            encoder.release_parameter()

        if not self._is_armable_track(track):
            return

        mixer = track.mixer_device
        sends = list(mixer.sends[: NUM_TRACK_PARAMS - 1])
        params = [mixer.volume] + sends

        logger.info("Track controls: %s (volume + %d sends)", track.name, len(sends))

        # Map in reverse order (volume on last encoder)
        for i, param in enumerate(params):
            encoder_index = len(track_encoders) - 1 - i
            if encoder_index >= 0:
                track_encoders[encoder_index].connect_to(param)

    def _setup_mixer(self):
        self._mixer = MixerComponent(NUM_TRACKS, NUM_RETURNS)

        track_buttons = self._buttons[ButtonLayout.TRACK_SELECT]
        arm_buttons = self._long_buttons[ButtonLayout.TRACK_SELECT]
        for i in range(NUM_TRACKS):
            strip = self._mixer.channel_strip(i)
            strip.set_select_button(track_buttons[i])
            strip.set_arm_button(arm_buttons[i])

        return_buttons = self._buttons[ButtonLayout.RETURN_SELECT]
        for i in range(NUM_RETURNS):
            strip = self._mixer.return_strip(i)
            strip.set_select_button(return_buttons[i])
