import logging
from .Grid import Grid

logger = logging.getLogger(__name__)

def create_instance(c_instance):
    return Grid(c_instance)