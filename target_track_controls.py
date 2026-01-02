import logging

from ableton.v3.base import depends, listens
from ableton.v3.control_surface import Component
from ableton.v3.control_surface.controls import MappedControl

logger = logging.getLogger(__name__)


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
        self.__on_target_track_changed.subject = target_track
        self._update_controls()

    @listens("target_track")
    def __on_target_track_changed(self):
        self._update_controls()

    def _update_controls(self):
        track = self._target_track_provider.target_track if self._target_track_provider else None
        if track:
            logger.info("Target track changed: %s", track.name)
            mixer = track.mixer_device
            sends = list(mixer.sends)
            self.volume_control.mapped_parameter = mixer.volume
            for i, control in enumerate([self.send_a_control, self.send_b_control, self.send_c_control]):
                control.mapped_parameter = sends[i] if i < len(sends) else None
        else:
            self.volume_control.mapped_parameter = None
            for control in [self.send_a_control, self.send_b_control, self.send_c_control]:
                control.mapped_parameter = None
