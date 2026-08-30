# cue evolution — dev tasks. `make test` is the CI primitive: it runs the
# OFFLINE suite and needs neither DSPy's native stack nor an LLM key.
VENV := .venv/bin
.PHONY: test install dry sweep

install:        ## create venv + install (add '[optimize]' for real GEPA runs)
	python3 -m venv .venv && $(VENV)/pip install -e '.[dev]'

test:           ## run the offline test suite (no LLM key)
	$(VENV)/python -m pytest tests/ -q

dry:            ## smoke the CLI wiring (persona dry-run, offline)
	$(VENV)/python -m evolution.descriptions.evolve_description --target persona --profile core --dry-run

sweep:          ## dry-run sweep over a profile's skills (PROFILE=core)
	$(VENV)/python -m evolution.descriptions.evolve_description --all-skills --profile $(PROFILE) --dry-run
