import unreal
import os

def create_moriarty_blueprints():
    # Base path for the Moriarty content
    base_path = "/Game/Moriarty"
    
    # Create the directory if it doesn't exist
    if not unreal.EditorAssetLibrary.does_directory_exist(base_path):
        unreal.EditorAssetLibrary.make_directory(base_path)
        unreal.log(f"Created directory: {base_path}")

    # The base C++ class we want our blueprints to inherit from
    # Note: If the plugin is compiled, the class name will be available
    parent_class = unreal.EditorAssetLibrary.load_class("/Script/Moriarty.MoriartyActor")
    if not parent_class:
        unreal.log_warning("MoriartyActor C++ class not found. Make sure the Moriarty plugin is compiled and loaded.")
        # Fallback to standard Actor for demonstration
        parent_class = unreal.EditorAssetLibrary.load_class("/Script/Engine.Actor")

    blueprints_to_create = [
        {"name": "BP_Agent", "type": "agent"},
        {"name": "BP_NPC", "type": "npc"},
        {"name": "BP_WorldObject", "type": "object"}
    ]

    for bp in blueprints_to_create:
        asset_path = f"{base_path}/{bp['name']}"
        
        if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            factory = unreal.BlueprintFactory()
            factory.set_editor_property("parent_class", parent_class)
            
            asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
            new_blueprint = asset_tools.create_asset(
                asset_name=bp['name'],
                package_path=base_path,
                asset_class=unreal.Blueprint,
                factory=factory
            )
            
            if new_blueprint:
                unreal.log(f"Created Blueprint: {asset_path}")
                
                # If we were using our C++ class, we could set the default properties
                # (MoriartyType) here via the DefaultObject, but Python access can be
                # limited depending on how the UPROPERTYs are exposed.
                
            else:
                unreal.log_error(f"Failed to create {asset_path}")
        else:
            unreal.log(f"Blueprint already exists: {asset_path}")

    # Save all created assets
    unreal.EditorAssetLibrary.save_directory(base_path, False)

if __name__ == "__main__":
    create_moriarty_blueprints()
