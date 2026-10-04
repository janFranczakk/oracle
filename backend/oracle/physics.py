"""Pymunk is the only physics authority. There is no prediction code in this module."""

import pymunk

from oracle.world import BodyState, EditEvent, Frame, Shape, Vec2, World


class PhysicsEngine:
    def __init__(self, world: World):
        self.world = world.model_copy(deep=True)
        self.space = pymunk.Space(threaded=False)
        self.space.gravity = (world.environment.gravity.x, world.environment.gravity.y)
        self.space.iterations = world.environment.iterations
        self.space.collision_slop = 0.005
        self.tick = 0
        self.bodies: dict[str, tuple[BodyState, pymunk.Body, pymunk.Shape]] = {}
        self.contacts: set[str] = set()
        self.space.on_collision(None, None, begin=self._contact)
        for obj in world.objects:
            self.upsert(obj)

    def _contact(self, arbiter: pymunk.Arbiter, _space: pymunk.Space, _data: dict) -> None:
        for shape in arbiter.shapes:
            self.contacts.add(shape.oracle_id)

    def upsert(self, obj: BodyState) -> None:
        """Replace a body atomically after schema validation; edits clear its contact cache."""
        if (
            max(abs(obj.position.x), abs(obj.position.y), abs(obj.rotation)) > 1e6
            or max(abs(obj.velocity.x), abs(obj.velocity.y), abs(obj.angular_velocity)) > 1000
        ):
            raise ValueError("Object coordinates or velocities exceed the supported input range")
        self.remove(obj.id)
        moment = (
            pymunk.moment_for_circle(obj.mass, 0, obj.radius)
            if obj.shape == Shape.CIRCLE
            else pymunk.moment_for_box(obj.mass, (obj.width, obj.height))
        )
        body = (
            pymunk.Body(body_type=pymunk.Body.STATIC)
            if obj.static
            else pymunk.Body(obj.mass, moment)
        )
        body.position = (obj.position.x, obj.position.y)
        body.velocity = (obj.velocity.x, obj.velocity.y)
        body.angle = obj.rotation
        body.angular_velocity = obj.angular_velocity
        shape = (
            pymunk.Circle(body, obj.radius)
            if obj.shape == Shape.CIRCLE
            else pymunk.Poly.create_box(body, (obj.width, obj.height))
        )
        shape.friction = obj.friction
        shape.elasticity = obj.restitution
        shape.oracle_id = obj.id
        self.space.add(body, shape)
        self.bodies[obj.id] = (obj.model_copy(deep=True), body, shape)

    def remove(self, object_id: str) -> None:
        entry = self.bodies.pop(object_id, None)
        if entry:
            self.space.remove(entry[2], entry[1])

    def apply(self, event: EditEvent) -> None:
        if event.kind == "upsert":
            assert event.object is not None
            self.upsert(event.object)
        else:
            assert event.object_id is not None
            if event.object_id not in self.bodies:
                raise ValueError("The object to remove does not exist")
            self.remove(event.object_id)

    def step(self) -> Frame:
        self.contacts.clear()
        self.space.step(self.world.environment.dt)
        self.tick += 1
        return self.frame()

    def frame(self) -> Frame:
        objects = []
        for obj, body, _ in self.bodies.values():
            objects.append(
                obj.model_copy(
                    update={
                        "position": Vec2(x=body.position.x, y=body.position.y),
                        "velocity": Vec2(x=body.velocity.x, y=body.velocity.y),
                        "rotation": body.angle,
                        "angular_velocity": body.angular_velocity,
                    }
                )
            )
        # Validate engine output as well; reject non-finite states before serialization.
        return Frame.model_validate(
            {
                "tick": self.tick,
                "objects": [obj.model_dump() for obj in objects],
                "collisions": sorted(self.contacts),
            }
        )
