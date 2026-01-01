from ableton.v3.control_surface.components import (
    ClipSlotComponent as ClipSlotComponentBase,
    SceneComponent as SceneComponentBase,
    SessionComponent as SessionComponentBase,
)
from ableton.v3.live import liveobj_valid


class ClipSlotComponent(ClipSlotComponentBase):
    """Clip slot that toggles playback instead of retriggering."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._should_stop = False

    def _do_launch_slot(self):
        clip_slot = self._clip_slot
        if liveobj_valid(clip_slot) and clip_slot.has_clip:
            if clip_slot.clip.is_playing:
                clip_slot.stop()
                self._should_stop = True
                return
        self._should_stop = False
        super()._do_launch_slot()

    def _on_launch_button_released(self):
        # Don't fire on release if we just stopped the clip
        if self._should_stop:
            self._should_stop = False
            return
        super()._on_launch_button_released()


class SceneComponent(SceneComponentBase):
    clip_slot_component_type = ClipSlotComponent


class SessionComponent(SessionComponentBase):
    scene_component_type = SceneComponent
