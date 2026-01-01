import logging

from ableton.v3.control_surface import ControlSurface, ControlSurfaceSpecification, create_skin
from ableton.v3.control_surface.capabilities import (
    NOTES_CC,
    PORTS_KEY,
    SCRIPT,
    inport,
    outport,
)

from .elements import NUM_SCENES, NUM_TRACKS, Elements
from .mappings import create_mappings
from .session import SessionComponent
from .skin import Skin
from .target_track_controls import TargetTrackControlsComponent

logger = logging.getLogger(__name__)


def get_capabilities():
    return {
        PORTS_KEY: [
            inport(props=[NOTES_CC, SCRIPT]),
            outport(props=[NOTES_CC, SCRIPT]),
        ]
    }


def create_instance(c_instance):
    return Grid(c_instance=c_instance)


class Specification(ControlSurfaceSpecification):
    elements_type = Elements
    control_surface_skin = create_skin(skin=Skin)
    num_tracks = NUM_TRACKS
    num_scenes = NUM_SCENES
    create_mappings_function = create_mappings
    component_map = {
        "Session": SessionComponent,
        "Target_Track_Controls": TargetTrackControlsComponent,
    }
    include_returns = True
    include_master = False


class Grid(ControlSurface):
    def __init__(self, *a, **k):
        super().__init__(*a, specification=Specification, **k)

    def setup(self):
        super().setup()
        logger.info("Grid setup complete")

    def disconnect(self):
        super().disconnect()
        logger.info("Grid disconnected")
