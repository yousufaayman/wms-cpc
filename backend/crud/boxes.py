from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from typing import List, Dict, Optional, Any, Union
from ..models import Box, Client, WarehouseRack, BoxContent
from ..schemas import BoxCreate, BoxUpdate, BoxAggregation


def get_box(db: Session, id: int) -> Optional[Box]:
    return db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    ).filter(Box.id == id).first()


def get_box_by_barcode(db: Session, barcode: str) -> Optional[Box]:
    return db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    ).filter(Box.barcode == barcode).first()


def get_boxes(db: Session, *, skip: int = 0, limit: int = 100, received: Optional[bool] = None) -> List[Box]:
    query = db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    )
    
    if received is not None:
        query = query.filter(Box.received == received)
    
    return query.offset(skip).limit(limit).all()


def get_boxes_by_rack(db: Session, rack_id: int, *, skip: int = 0, limit: int = 100) -> List[Box]:
    return db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    ).filter(Box.rack_id == rack_id).offset(skip).limit(limit).all()


def get_boxes_by_carton_number(db: Session, carton_number: int, *, skip: int = 0, limit: int = 100) -> List[Box]:
    """Get boxes by carton number."""
    return db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    ).filter(Box.carton_number == carton_number).offset(skip).limit(limit).all()


def get_boxes_by_shipment(db: Session, shipment_id: int, *, skip: int = 0, limit: int = 100) -> List[Box]:
    """Get boxes by shipment ID."""
    return db.query(Box).options(
        joinedload(Box.client),
        joinedload(Box.rack)
    ).filter(Box.shipment_id == shipment_id).offset(skip).limit(limit).all()


def create_box(db: Session, *, obj_in: BoxCreate) -> Box:
    db_obj = Box(
        rack_id=obj_in.rack_id,
        client_id=obj_in.client_id,
        barcode=obj_in.barcode,
        weight=obj_in.weight,
        received=obj_in.received,
        carton_number=obj_in.carton_number,
        shipment_id=obj_in.shipment_id
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_box(
    db: Session, *, db_obj: Box, obj_in: Union[BoxUpdate, Dict[str, Any]]
) -> Box:
    if isinstance(obj_in, dict):
        update_data = obj_in
    else:
        update_data = obj_in.dict(exclude_unset=True)
    
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def delete_box(db: Session, *, id: int) -> Optional[Box]:
    obj = db.query(Box).get(id)
    if obj:
        db.delete(obj)
        db.commit()
    return obj


def get_boxes_with_aggregations(db: Session, *, skip: int = 0, limit: int = 100) -> List[BoxAggregation]:
    """Get boxes with pre-calculated aggregations from the materialized view."""
    query = text("""
        SELECT 
            box_id,
            barcode,
            rack_id,
            client_id,
            box_weight,
            received,
            rack_code,
            client_name,
            total_pieces,
            distinct_items,
            distinct_models,
            distinct_colors,
            distinct_sizes,
            model_names,
            color_names,
            size_values,
            job_order_item_ids,
            total_content_weight,
            max_piece_count,
            min_piece_count,
            avg_piece_count
        FROM wms.box_aggregations
        ORDER BY barcode
        OFFSET :offset LIMIT :limit
    """)
    
    result = db.execute(query, {"offset": skip, "limit": limit})
    return [BoxAggregation(**row._asdict()) for row in result]


def get_boxes_with_aggregations_by_warehouse(db: Session, warehouse_id: int, *, skip: int = 0, limit: int = 100, received: Optional[bool] = None) -> List[BoxAggregation]:
    """Get boxes with aggregations filtered by warehouse through rack association."""
    where_conditions = ["(wr.warehouse_id = :warehouse_id OR ba.rack_id IS NULL)"]
    params = {"warehouse_id": warehouse_id, "offset": skip, "limit": limit}
    
    if received is not None:
        where_conditions.append("ba.received = :received")
        params["received"] = received
    
    where_clause = " AND ".join(where_conditions)
    
    query = text(f"""
        SELECT 
            ba.box_id,
            ba.barcode,
            ba.rack_id,
            ba.client_id,
            ba.box_weight,
            ba.received,
            ba.rack_code,
            ba.client_name,
            ba.total_pieces,
            ba.distinct_items,
            ba.distinct_models,
            ba.distinct_colors,
            ba.distinct_sizes,
            ba.model_names,
            ba.color_names,
            ba.size_values,
            ba.job_order_item_ids,
            ba.total_content_weight,
            ba.max_piece_count,
            ba.min_piece_count,
            ba.avg_piece_count
        FROM wms.box_aggregations ba
        LEFT JOIN wms.warehouse_racks wr ON ba.rack_id = wr.id
        WHERE {where_clause}
        ORDER BY ba.barcode
        OFFSET :offset LIMIT :limit
    """)
    
    result = db.execute(query, params)
    return [BoxAggregation(**row._asdict()) for row in result]


def search_boxes_with_aggregations(
    db: Session, 
    *, 
    search_term: Optional[str] = None,
    rack_code: Optional[str] = None,
    client_name: Optional[str] = None,
    model_name: Optional[str] = None,
    color_name: Optional[str] = None,
    size_value: Optional[str] = None,
    job_order_item_id: Optional[int] = None,
    received: Optional[bool] = None,
    skip: int = 0, 
    limit: int = 100
) -> List[BoxAggregation]:
    """Search boxes with aggregations using various filters."""
    where_conditions = []
    params = {"offset": skip, "limit": limit}
    
    if search_term:
        where_conditions.append("ba.barcode ILIKE :search_term")
        params["search_term"] = f"%{search_term}%"
    
    if rack_code:
        where_conditions.append("ba.rack_code ILIKE :rack_code")
        params["rack_code"] = f"%{rack_code}%"
    
    if client_name:
        where_conditions.append("ba.client_name ILIKE :client_name")
        params["client_name"] = f"%{client_name}%"
    
    if model_name:
        where_conditions.append(":model_name = ANY(ba.model_names)")
        params["model_name"] = model_name
    
    if color_name:
        where_conditions.append(":color_name = ANY(ba.color_names)")
        params["color_name"] = color_name
    
    if size_value:
        where_conditions.append(":size_value = ANY(ba.size_values)")
        params["size_value"] = size_value
    
    if job_order_item_id:
        where_conditions.append(":job_order_item_id = ANY(ba.job_order_item_ids)")
        params["job_order_item_id"] = job_order_item_id
    
    if received is not None:
        where_conditions.append("ba.received = :received")
        params["received"] = received
    
    where_clause = " AND ".join(where_conditions) if where_conditions else "1=1"
    
    query = text(f"""
        SELECT 
            ba.box_id,
            ba.barcode,
            ba.rack_id,
            ba.client_id,
            ba.box_weight,
            ba.received,
            ba.rack_code,
            ba.client_name,
            ba.total_pieces,
            ba.distinct_items,
            ba.distinct_models,
            ba.distinct_colors,
            ba.distinct_sizes,
            ba.model_names,
            ba.color_names,
            ba.size_values,
            ba.job_order_item_ids,
            ba.total_content_weight,
            ba.max_piece_count,
            ba.min_piece_count,
            ba.avg_piece_count
        FROM wms.box_aggregations ba
        WHERE {where_clause}
        ORDER BY ba.barcode
        OFFSET :offset LIMIT :limit
    """)
    
    result = db.execute(query, params)
    return [BoxAggregation(**row._asdict()) for row in result]


def refresh_box_aggregations(db: Session) -> None:
    """Refresh the materialized view for box aggregations."""
    db.execute(text("SELECT wms.refresh_box_aggregations()"))
    db.commit()


def bulk_create_boxes_with_contents(
    db: Session, 
    boxes_data: List[Dict[str, Any]], 
    box_contents_data: List[Dict[str, Any]]
) -> None:
    """Create multiple boxes and their contents efficiently with disabled triggers."""
    try:
        # Disable triggers for bulk operation
        db.execute(text("ALTER TABLE wms.box_contents DISABLE TRIGGER ALL"))
        db.execute(text("ALTER TABLE wms.boxes DISABLE TRIGGER ALL"))
        
        # Insert boxes
        if boxes_data:
            for box_data in boxes_data:
                box = Box(**box_data)
                db.add(box)
            db.flush()  # Get the IDs without committing
        
        # Insert box contents
        if box_contents_data:
            for content_data in box_contents_data:
                content = BoxContent(**content_data)
                db.add(content)
        
        # Commit all changes
        db.commit()
        
        # Re-enable triggers
        db.execute(text("ALTER TABLE wms.box_contents ENABLE TRIGGER ALL"))
        db.execute(text("ALTER TABLE wms.boxes ENABLE TRIGGER ALL"))
        
        # Schedule a single refresh for all changes
        db.execute(text("SELECT wms.schedule_aggregation_refresh()"))
        db.commit()
        
    except Exception as e:
        db.rollback()
        # Re-enable triggers even on error
        try:
            db.execute(text("ALTER TABLE wms.box_contents ENABLE TRIGGER ALL"))
            db.execute(text("ALTER TABLE wms.boxes ENABLE TRIGGER ALL"))
            db.commit()
        except:
            pass
        raise e


def get_aggregation_status(db: Session) -> Dict[str, Any]:
    """Get current status of aggregations."""
    try:
        # Get total boxes in aggregations
        result = db.execute(text("SELECT COUNT(*) FROM wms.box_aggregations"))
        total_boxes = result.scalar()
        
        # Get pending refresh requests
        result = db.execute(text("""
            SELECT COUNT(*) FROM wms.aggregation_refresh_queue 
            WHERE status = 'pending'
        """))
        pending_refreshes = result.scalar()
        
        # Get processing refresh requests
        result = db.execute(text("""
            SELECT COUNT(*) FROM wms.aggregation_refresh_queue 
            WHERE status = 'processing'
        """))
        processing_refreshes = result.scalar()
        
        return {
            'total_boxes': total_boxes,
            'pending_refreshes': pending_refreshes,
            'processing_refreshes': processing_refreshes
        }
    except Exception as e:
        return {'error': str(e)}

