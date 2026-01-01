import logging

from ableton.v3.base import depends, listens
from ableton.v3.control_surface import Component
from ableton.v3.control_surface.controls import MappedControl

logger = logging.getLogger(__name__)

NUM_SENDS = 3


class TargetTrackControlsComponent(Component):
    """Controls volume and sends for the currently selected track."""

    volume_control = MappedControl()
    send_a_control = MappedControl()
    send_b_control = MappedControl()
    send_c_control = MappedControl()

    @depends(target_track=None)
    def __init__(self, *a, target_track=None, **k):
        super().__init__(*a, **k)
        self._target_track_provider = target_track
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
