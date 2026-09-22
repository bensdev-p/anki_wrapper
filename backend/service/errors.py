class ServiceError(Exception):
    """Base class for expected, user-facing service errors."""


class NotFound(ServiceError):
    pass


class StaleCard(ServiceError):
    """The card being answered is no longer at the front of the queue
    (answered on another device, or already answered)."""


class NothingToUndo(ServiceError):
    pass
