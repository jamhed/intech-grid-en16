from ableton.v3.control_surface.components import (
    ClipSlotComponent as ClipSlotComponentBase,
    SceneComponent as SceneComponentBase,
    SessionComponent as SessionComponentBase,
)
from ableton.v3.live import liveobj_valid


class ClipSlotComponent(ClipSlotComponentBase):
    """Clip slot that toggles playback instead of retriggering."""

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
