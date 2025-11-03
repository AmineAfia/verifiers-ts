#!/usr/bin/env python3
"""
Python bridge for Prime Intellect sandboxes
Allows TypeScript to call prime-sandboxes library via subprocess

Usage:
    echo '{"method": "create", "config": {...}}' | python sandbox_bridge.py
    echo '{"method": "execute", "sandbox_id": "...", "command": "..."}' | python sandbox_bridge.py
    echo '{"method": "delete", "sandbox_id": "..."}' | python sandbox_bridge.py
"""

import asyncio
import json
import sys
from typing import Any, Dict

try:
    from prime_sandboxes import (
        AsyncSandboxClient,
        CreateSandboxRequest,
    )
    PRIME_SANDBOXES_AVAILABLE = True
except ImportError:
    PRIME_SANDBOXES_AVAILABLE = False
    AsyncSandboxClient = None
    CreateSandboxRequest = None


async def create_sandbox(config: Dict[str, Any]) -> Dict[str, Any]:
    """Create a sandbox using prime-sandboxes."""
    if not PRIME_SANDBOXES_AVAILABLE:
        raise ImportError(
            "prime-sandboxes is not installed. Install it with: pip install prime-sandboxes"
        )
    
    client = AsyncSandboxClient()
    request = CreateSandboxRequest(
        name=config.get("name", "sandbox-env"),
        docker_image=config.get("dockerImage", "python:3.11-slim"),
        start_command=config.get("startCommand", "tail -f /dev/null"),
        cpu_cores=config.get("cpuCores", 1),
        memory_gb=config.get("memoryGb", 2),
        disk_size_gb=config.get("diskSizeGb", 5),
        gpu_count=config.get("gpuCount", 0),
        timeout_minutes=config.get("timeoutMinutes", 60),
        environment_vars=config.get("environmentVars", {}),
        team_id=config.get("teamId"),
        advanced_configs=config.get("advancedConfigs"),
    )
    
    sandbox = await client.create(request)
    return {"id": sandbox.id}


async def execute_command(sandbox_id: str, command: str) -> Dict[str, Any]:
    """Execute a command in a sandbox."""
    if not PRIME_SANDBOXES_AVAILABLE:
        raise ImportError(
            "prime-sandboxes is not installed. Install it with: pip install prime-sandboxes"
        )
    
    client = AsyncSandboxClient()
    
    # Wait for sandbox to be ready if needed
    await client.wait_for_creation(sandbox_id)
    
    # Execute command
    result = await client.execute_command(sandbox_id, command)
    
    return {
        "stdout": result.stdout.strip() if result.stdout else "",
        "stderr": result.stderr.strip() if result.stderr else "",
    }


async def delete_sandbox(sandbox_id: str) -> Dict[str, Any]:
    """Delete a sandbox."""
    if not PRIME_SANDBOXES_AVAILABLE:
        raise ImportError(
            "prime-sandboxes is not installed. Install it with: pip install prime-sandboxes"
        )
    
    client = AsyncSandboxClient()
    await client.delete(sandbox_id)
    
    return {"success": True}


async def handle_command(command: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a command and return result."""
    method = command.get("method")
    
    if method == "create":
        config = command.get("config", {})
        return await create_sandbox(config)
    elif method == "execute":
        sandbox_id = command.get("sandbox_id")
        cmd = command.get("command")
        if not sandbox_id or not cmd:
            raise ValueError("sandbox_id and command are required for execute method")
        return await execute_command(sandbox_id, cmd)
    elif method == "delete":
        sandbox_id = command.get("sandbox_id")
        if not sandbox_id:
            raise ValueError("sandbox_id is required for delete method")
        return await delete_sandbox(sandbox_id)
    else:
        raise ValueError(f"Unknown method: {method}. Supported methods: create, execute, delete")


def main():
    """Main entry point - read JSON from stdin, execute command, output JSON to stdout."""
    # Redirect stderr for logs (only JSON goes to stdout)
    import sys as sys_module
    
    try:
        # Read JSON command from stdin
        input_data = sys.stdin.read()
        if not input_data.strip():
            raise ValueError("No input provided")
        
        command = json.loads(input_data)
        
        # Execute async command
        result = asyncio.run(handle_command(command))
        
        # Output JSON result to stdout
        print(json.dumps(result))
        sys_module.exit(0)
        
    except Exception as e:
        # Output error as JSON to stderr, exit with error code
        error_data = {
            "error": str(e),
            "error_type": type(e).__name__,
        }
        print(json.dumps(error_data), file=sys.stderr)
        sys_module.exit(1)


if __name__ == "__main__":
    main()


