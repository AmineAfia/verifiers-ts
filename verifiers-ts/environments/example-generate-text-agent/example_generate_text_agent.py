"""
Python wrapper for example-generate-text-agent TypeScript environment
Uses the existing Python bridge to enable vf-eval compatibility
"""

import sys
from pathlib import Path

# Add the verifiers-ts python-bridge to path
# Bridge is located at verifiers-ts/python-bridge relative to this file
env_dir = Path(__file__).parent
bridge_path = env_dir.parent.parent / "python-bridge"

if str(bridge_path) not in sys.path:
    sys.path.insert(0, str(bridge_path))

from verifiers_ts_loader import load_ts_environment


def load_environment(**kwargs):
    """
    Load the TypeScript environment.
    This function signature matches what vf.load_environment expects.
    
    Args:
        **kwargs: Arguments to pass to the TypeScript loadEnvironment function
    
    Returns:
        TSEnvironmentWrapper instance that implements the Environment interface
    """
    # Get the directory containing this Python file (the environment directory)
    env_dir = Path(__file__).parent
    
    # The bridge expects env_dir_path to point to the parent of environment directories
    # So we pass the parent directory (where all environments are)
    env_dir_path = env_dir.parent
    
    return load_ts_environment(
        env_id="example-generate-text-agent",
        env_dir_path=str(env_dir_path),
        **kwargs
    )



